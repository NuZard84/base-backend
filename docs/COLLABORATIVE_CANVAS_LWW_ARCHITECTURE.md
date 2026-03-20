# Collaborative Canvas: Production-Grade LWW Architecture

> Property-level Last-Write-Wins (LWW) synchronization for real-time collaborative canvas. Designed for scale, reliability, and enterprise deployment.

---

## 1. Executive Summary

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Sync Protocol** | Property-level LWW | Conflict resolution for discrete objects |
| **Transport** | WebSocket (Socket.io) | Real-time broadcast |
| **Pub/Sub** | Redis | Cross-instance sync, horizontal scaling |
| **Auth** | JWT + CanvasShare | Per-canvas access control |
| **Persistence** | PostgreSQL + Prisma | Source of truth |
| **Versioning** | Hybrid logical clock (HLC) or monotonic version | LWW ordering |

---

## 2. Data Model Changes

### 2.1 Node Versioning (LWW Core)

Add version per node for LWW ordering. Use **monotonic version** (simpler) or **Hybrid Logical Clock** (distributed, no single source of truth).

```prisma
model Node {
  // ... existing fields ...
  
  version   BigInt   @default(0)   // Monotonic: server increments on each update
  updatedBy String?               // userId who last updated (audit)
  
  @@index([canvasId, version])    // For "changes since version" queries
}
```

**Alternative: Property-level versioning** (Figma-style, more granular)

```prisma
model Node {
  // ... existing fields ...
  
  // Per-property versions (JSON: { "x": 5, "y": 5, "content": 12 })
  // Server uses max(version) for whole-node ordering; client can merge at property level
  propertyVersions Json @default("{}")  // { "x": 1, "y": 1, "width": 1, "content": 1 }
  updatedAt        DateTime @updatedAt  // Fallback for LWW
}
```

**Recommendation for v1**: Use **node-level `version` (BigInt)**. Simpler, sufficient for most conflicts. Property-level can be added later if needed.

---

### 2.2 Canvas Share (Collaboration Model)

```prisma
enum CanvasRole {
  OWNER    // Full control, delete canvas, manage members
  EDITOR   // Create/edit/delete nodes, sync
  COMMENTOR // View + add comments only
  VIEWER   // View only
}

model CanvasShare {
  id        String     @id @default(uuid())
  canvasId  String
  userId    String
  role      CanvasRole @default(EDITOR)
  status    ShareStatus @default(ACTIVE)  // ACTIVE | PENDING | REMOVED
  
  invitedBy   String?
  invitedAt   DateTime  @default(now())
  acceptedAt  DateTime?
  
  canvas  Canvas @relation(fields: [canvasId], references: [id], onDelete: Cascade)
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([canvasId, userId])
  @@index([userId])
  @@index([canvasId])
  @@map("canvas_shares")
}

enum ShareStatus {
  ACTIVE
  PENDING   // Invited, not yet accepted
  REMOVED
}
```

**Canvas model update:**
```prisma
model Canvas {
  // ... existing ...
  shares CanvasShare[]
}
```

---

### 2.3 Edge Versioning (Optional)

Edges are simpler: add/remove. LWW at edge level = last add wins if duplicate. For delete, use soft-delete with `deletedAt` + version if you need undo.

**v1**: No edge versioning. Add/delete is idempotent.

---

## 3. LWW Protocol Design

### 3.1 Version Semantics

- **Server is authority**: Server assigns `version` on every write.
- **Client sends**: `{ nodeId, clientId, properties, clientVersion? }`
- **Server**: If `clientVersion < serverVersion` → reject (stale). Else apply, increment version, broadcast.

### 3.2 Sync Flow

```
Client A                    Server                     Client B
   |                          |                            |
   |-- delta { nodesUpdated }-|                            |
   |   (with clientVersion)   |                            |
   |                          |-- validate LWW             |
   |                          |-- persist, version++       |
   |                          |-- Redis PUB canvas:123     |
   |<-- ack { version, idMap }|                            |
   |                          |-- WS broadcast ----------->|-- apply remote
   |                          |                            |
```

### 3.3 Conflict Resolution Rules

| Scenario | Action |
|----------|--------|
| Client sends update, server version newer | Reject, return 409 + latest state |
| Client sends update, server version same or older | Apply, increment, broadcast |
| Two updates for same node, different properties | Merge (both applied) — requires property-level version |
| Two updates for same node, same property | Last write wins (by server timestamp) |

### 3.4 Idempotency

- Use `clientId` (frontend ID) + `canvasId` as idempotency key.
- Duplicate requests (retries) → same result, no double-increment.

---

## 4. Backend Architecture

### 4.1 Module Structure

```
src/
├── modules/
│   ├── canvases/
│   │   ├── canvases.controller.ts      # REST (unchanged)
│   │   ├── canvases.service.ts         # + LWW logic, version checks
│   │   ├── canvases.gateway.ts         # NEW: WebSocket
│   │   ├── canvas-shares/              # NEW: sharing service
│   │   │   ├── canvas-shares.service.ts
│   │   │   ├── canvas-shares.controller.ts
│   │   │   └── dto/
│   │   └── dto/
│   │       └── sync-node.dto.ts       # + version, clientVersion
```

### 4.2 Sync DTO Updates

```typescript
// sync-node.dto.ts additions
export class SyncNodeItemDto {
  // ... existing ...
  
  @IsOptional()
  @IsNumber()
  version?: number;  // Client's last known version (for optimistic concurrency)
}

export class SyncCanvasDto {
  // ... existing ...
  
  @IsOptional()
  @IsNumber()
  clientClock?: number;  // Client timestamp for ordering (optional, server can use server time)
}
```

### 4.3 CanvasesService LWW Logic

```typescript
// Pseudocode for delta sync with LWW
async runDeltaSync(userId, canvasId, dto) {
  await this.ensureCanvasAccess(userId, canvasId, 'EDITOR');
  
  for (const node of dto.nodesUpdated) {
    const existing = await this.prisma.node.findUnique({
      where: { canvasId_clientId: { canvasId, clientId: node.id } },
      select: { id, version: true }
    });
    
    if (existing && node.version != null && node.version < existing.version) {
      // Stale update - reject or return conflict
      throw new ConflictException({
        code: 'STALE_UPDATE',
        nodeId: node.id,
        serverVersion: existing.version,
        clientVersion: node.version,
      });
    }
    
    // Apply update, increment version
    await this.prisma.node.update({
      where: { id: existing.id },
      data: { ...nodeData, version: { increment: 1 }, updatedBy: userId }
    });
  }
  
  // Publish to Redis for broadcast
  await this.redis.publish(`canvas:${canvasId}:updates`, JSON.stringify(payload));
}
```

---

## 5. Real-Time Layer

### 5.1 WebSocket Gateway

```typescript
// canvases.gateway.ts
@WebSocketGateway({ cors: true, namespace: 'canvases' })
export class CanvasesGateway {
  @WebSocketServer() server: Server;
  
  constructor(
    private jwtService: JwtService,
    private canvasSharesService: CanvasSharesService,
  ) {}
  
  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    const user = await this.verifyToken(token);
    if (!user) { client.disconnect(); return; }
    
    client.data.userId = user.userId;
  }
  
  @SubscribeMessage('join')
  async handleJoin(client: Socket, canvasId: string) {
    const hasAccess = await this.canvasSharesService.canAccess(
      client.data.userId, canvasId, 'VIEWER'
    );
    if (!hasAccess) { return { error: 'FORBIDDEN' }; }
    
    await client.join(`canvas:${canvasId}`);
    return { ok: true };
  }
  
  @SubscribeMessage('leave')
  handleLeave(client: Socket, canvasId: string) {
    return client.leave(`canvas:${canvasId}`);
  }
}
```

### 5.2 Redis Pub/Sub

```typescript
// canvas-sync.publisher.ts
@Injectable()
export class CanvasSyncPublisher {
  constructor(private redis: RedisService) {}
  
  async publishUpdate(canvasId: string, payload: CanvasUpdatePayload) {
    await this.redis.publish(`canvas:${canvasId}:updates`, JSON.stringify(payload));
  }
}

// canvas-sync.subscriber.ts
@Injectable()
export class CanvasSyncSubscriber implements OnModuleInit {
  constructor(
    private redis: RedisService,
    private gateway: CanvasesGateway,
  ) {}
  
  async onModuleInit() {
    const subscriber = this.redis.duplicate();
    await subscriber.subscribe('canvas:*:updates');  // Or pattern subscribe
    subscriber.on('message', (channel, message) => {
      const canvasId = channel.replace('canvas:', '').replace(':updates', '');
      this.gateway.broadcastToCanvas(canvasId, JSON.parse(message));
    });
  }
}
```

**Note**: Redis `SUBSCRIBE` doesn't support pattern subscribe for multiple channels. Use one channel per canvas: `canvas:${canvasId}:updates`, and subscribe dynamically when first user joins, or use a single global channel with canvasId in payload (less efficient).

**Better approach**: Single channel `canvas:updates`, payload includes `canvasId`. All instances subscribe. Each instance filters and broadcasts only to local clients in that canvas room.

---

## 6. Access Control

### 6.1 Replace `ensureCanvasOwnership` with `ensureCanvasAccess`

```typescript
async ensureCanvasAccess(
  userId: string,
  canvasId: string,
  minRole: CanvasRole = 'VIEWER'
): Promise<void> {
  const canvas = await this.prisma.canvas.findUnique({
    where: { id: canvasId },
    include: { shares: { where: { userId, status: 'ACTIVE' } } }
  });
  if (!canvas) throw new NotFoundException('Canvas not found');
  
  if (canvas.userId === userId) return;  // Owner
  const share = canvas.shares[0];
  if (!share) throw new ForbiddenException('No access');
  
  const roleOrder = { OWNER: 4, EDITOR: 3, COMMENTOR: 2, VIEWER: 1 };
  if (roleOrder[share.role] < roleOrder[minRole]) {
    throw new ForbiddenException('Insufficient permission');
  }
}
```

### 6.2 Invite Flow

- `POST /canvases/:id/invite` — `{ email, role }` → create CanvasShare (PENDING), send email/link
- `POST /canvases/:id/accept-invite` — accept, set ACTIVE
- `DELETE /canvases/:id/members/:userId` — remove share
- `GET /canvases/:id/members` — list collaborators

---

## 7. Scaling & Deployment

### 7.1 Horizontal Scaling

| Component | Scaling Strategy |
|-----------|------------------|
| **NestJS** | Stateless, scale replicas (Cloud Run, K8s) |
| **WebSocket** | Sticky sessions (session affinity) OR Redis adapter for Socket.io |
| **Redis** | Single instance → Redis Cluster for HA |
| **PostgreSQL** | Read replicas for `findNodesInViewport`, primary for writes |

### 7.2 Socket.io Redis Adapter

```typescript
import { createAdapter } from '@socket.io/redis-adapter';

const pubClient = redis.duplicate();
const subClient = redis.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

This allows WebSocket broadcasts to reach clients on *any* server instance. Essential for multi-replica deployment.

### 7.3 Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `PUT /canvases/:id/sync` | 30 req/min per user per canvas |
| WebSocket messages | 60/min per connection (throttle `nodesUpdated` batch size) |

### 7.4 Connection Limits

- Max 50 concurrent users per canvas (configurable)
- Max 5 canvases per WebSocket connection (join multiple rooms)

---

## 8. Observability

### 8.1 Metrics

- `canvas_sync_duration_seconds` — histogram
- `canvas_sync_conflicts_total` — counter (LWW rejections)
- `canvas_ws_connections` — gauge per canvas
- `canvas_sync_delta_size` — histogram (nodes per sync)

### 8.2 Logging

- Structured JSON logs: `{ canvasId, userId, action, nodeCount, version, durationMs }`
- Log 409 conflicts for debugging

### 8.3 Tracing

- Trace ID across REST → DB → Redis → WebSocket
- Use OpenTelemetry for distributed tracing

---

## 9. Security

| Threat | Mitigation |
|--------|-------------|
| Unauthorized canvas access | JWT + CanvasShare check on every REST + WS |
| Replay attacks | Idempotency keys, short-lived tokens |
| DoS (sync spam) | Rate limit, batch size limit (e.g. max 100 nodes per delta) |
| XSS in content | Sanitize `content` JSON on server (or trust client, CSP on frontend) |

---

## 10. Implementation Phases

### Phase 1: Foundation (1–2 weeks)
- [ ] Add `version` to Node, migration
- [ ] Add CanvasShare model, migrations
- [ ] Implement `ensureCanvasAccess`, replace ownership checks
- [ ] Canvas shares CRUD API (invite, list, remove)

### Phase 2: LWW Sync (1 week)
- [ ] Add `version` to SyncNodeItemDto
- [ ] Implement version check in `runDeltaSync`, reject stale
- [ ] Return `version` in sync response, include in findNodesInViewport

### Phase 3: Real-Time (1–2 weeks)
- [ ] Add `@nestjs/websockets`, `socket.io`
- [ ] CanvasesGateway: auth, join/leave room
- [ ] After sync success: emit to room (single instance)
- [ ] Frontend: connect WS, subscribe to canvas, apply remote updates

### Phase 4: Multi-Instance (1 week)
- [ ] Redis pub/sub: publish on sync
- [ ] Subscriber: broadcast to local gateway
- [ ] Socket.io Redis adapter for cross-instance broadcast

### Phase 5: Polish
- [ ] Presence (who's viewing) — optional
- [ ] Cursors — optional
- [ ] Conflict UI (show "updated by X, refresh?") for 409

---

## 11. API Summary

### REST (Additions)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/canvases/:id/invite` | Invite user by email |
| GET | `/canvases/:id/members` | List collaborators |
| PATCH | `/canvases/:id/members/:userId` | Change role |
| DELETE | `/canvases/:id/members/:userId` | Remove collaborator |
| POST | `/canvases/:id/accept-invite` | Accept pending invite |

### WebSocket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `join` | Client → Server | `canvasId` |
| `leave` | Client → Server | `canvasId` |
| `canvas:updated` | Server → Client | `{ nodesUpdated, nodesDeleted, edgesAdded, edgesDeleted, version }` |

---

## 12. References

- [Figma's multiplayer tech](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [Hybrid Logical Clocks](https://cse.buffalo.edu/tech-reports/2014-04.pdf) (optional for distributed versioning)
- [Socket.io Redis Adapter](https://socket.io/docs/v4/redis-adapter/)
- [NestJS WebSockets](https://docs.nestjs.com/websockets/gateways)
