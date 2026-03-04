# Canvas API — Implementation Reference

## Authentication

All endpoints require **JWT Bearer authentication** via `JwtAuthGuard`.  
Include header: `Authorization: Bearer <accessToken>`

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/canvases` | Create canvas |
| GET | `/canvases` | List all canvases for current user (nodeCount, edgeCount, bounds, viewport) |
| GET | `/canvases/:id` | Get full canvas with nodes and edges |
| GET | `/canvases/:id/nodes` | Fetch nodes — full list, or spatial query (minX/maxX/minY/maxY) or by tileIds |
| PUT | `/canvases/:id/sync` | Bulk sync nodes + edges (atomic upsert) |
| PATCH | `/canvases/:id/rename` | Rename canvas |
| DELETE | `/canvases/:id` | Delete canvas |

**Note:** `GET :id/nodes` must be defined before `GET :id` in the controller; otherwise NestJS matches `nodes` as the `:id` param.

---

## Request/Response Contracts

### POST /canvases — Create Canvas

**Body** (`CreateCanvasDto`):

```json
{
  "name": "My Canvas",
  "description": "Optional description",
  "viewportX": 0,
  "viewportY": 0
}
```

All fields optional. If `name` is missing, auto-generates `PROOJ-XXXX`. If `description` missing, uses `${name}'s description`.

**Response:** Full Canvas (Prisma model with id, name, description, userId, etc.)

---

### GET /canvases — List Canvases

**Response:** Array of canvas list items:

```json
[
  {
    "id": "uuid",
    "name": "string",
    "description": "string | null",
    "nodeCount": 0,
    "edgeCount": 0,
    "boundsMinX": 0,
    "boundsMinY": 0,
    "boundsMaxX": 0,
    "boundsMaxY": 0,
    "viewportX": 0,
    "viewportY": 0,
    "viewportZoom": 1,
    "updatedAt": "2025-03-04T..."
  }
]
```

Ordered by `updatedAt` descending.

---

### GET /canvases/:id — Full Canvas

**Response:** Canvas with nested nodes and edges:

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string | null",
  "boundsMinX": 0,
  "boundsMinY": 0,
  "boundsMaxX": 0,
  "boundsMaxY": 0,
  "viewportX": 0,
  "viewportY": 0,
  "viewportZoom": 1,
  "nodeCount": 2,
  "edgeCount": 1,
  "userId": "uuid",
  "createdAt": "2025-03-04T...",
  "updatedAt": "2025-03-04T...",
  "nodes": [
    {
      "id": "uuid",
      "clientId": "1709123456789",
      "x": 100,
      "y": 200,
      "width": 360,
      "height": 240,
      "zIndex": 0,
      "nodeType": "QUESTION",
      "content": { "question": "how can i help?", "model": "gemini-2.5-flash" },
      "metadata": {},
      "style": {},
      "bboxMinX": 100,
      "bboxMinY": 200,
      "bboxMaxX": 460,
      "bboxMaxY": 440,
      "tileIds": [...],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "edges": [
    {
      "id": "uuid",
      "sourceNodeId": "node-uuid",
      "targetNodeId": "node-uuid",
      "sourceNode": { "clientId": "1709123456789" },
      "targetNode": { "clientId": "1709123456790" }
    }
  ]
}
```

Nodes ordered by `zIndex` asc, then `createdAt` asc.

---

### GET /canvases/:id/nodes — Viewport / Spatial Query

**Query** (`ViewportQueryDto`):

| Param | Type | Description |
|-------|------|-------------|
| `minX` | number | Viewport min X |
| `minY` | number | Viewport min Y |
| `maxX` | number | Viewport max X |
| `maxY` | number | Viewport max Y |
| `tileIds` | number[] | Comma-separated tile IDs, e.g. `tileIds=1,2,20001` |

**Behavior:**
- If `tileIds` provided: returns nodes whose `tileIds` array `hasSome` of the given IDs.
- Else if `minX, minY, maxX, maxY` all provided: returns nodes overlapping viewport (bbox overlap: `bboxMinX < maxX AND bboxMaxX > minX AND bboxMinY < maxY AND bboxMaxY > minY`).
- Else: returns all nodes for the canvas.

**Response:** Array of Node objects (id, clientId, x, y, width, height, zIndex, nodeType, content, metadata, style, bbox, etc.)

---

### PUT /canvases/:id/sync — Bulk Sync

**Body** (`SyncCanvasDto`):

```json
{
  "nodes": [
    {
      "id": "1709123456789",
      "x": 100,
      "y": 200,
      "width": 360,
      "height": 240,
      "type": "QuestionNode",
      "data": { "question": "how can i help?", "model": "gemini-2.5-flash" },
      "zIndex": 0
    }
  ],
  "edges": [
    { "source": "1709123456789", "target": "1709123456790", "metadata": {} }
  ],
  "viewportX": -453.16,
  "viewportY": 56.24,
  "viewportZoom": 0.676
}
```

**Node fields** (`SyncNodeItemDto`):
- `id` (required): Frontend client ID (e.g. timestamp string)
- `x`, `y` (required): Position
- `width`, `height` (optional, default 360×240)
- `type` (optional): `QuestionNode`, `ResponseNode`, `LoadingNode`, `ImageNode`, `CommentNode`, `NotesNode`, `YoutubeNode` → mapped to Prisma NodeType
- `data` (optional): JSON object stored in `content` field
- `zIndex` (optional, default 0)

**Edge fields** (`SyncEdgeItemDto`):
- `source`, `target` (required): Frontend node clientIds
- `metadata` (optional): JSON object

**Response:**

```json
{
  "nodeCount": 2,
  "edgeCount": 1,
  "nodeIdMap": {
    "1709123456789": "db-uuid-1",
    "1709123456790": "db-uuid-2"
  },
  "edges": [
    { "id": "edge-uuid", "source": "1709123456789", "target": "1709123456790" }
  ]
}
```

**Sync behavior:**
- Nodes: upsert by `(canvasId, clientId)`. Nodes in DB but not in payload are deleted (and their edges).
- Edges: full replace — all canvas edges deleted, then recreated from payload (only edges whose source/target exist).
- Per node: computes bbox, tileIds; maps `type` → NodeType; stores `data` in `content`.
- Entire sync runs in a single transaction (30s timeout).
- Updates canvas: nodeCount, edgeCount, bounds, viewportX/Y/Zoom.

---

### PATCH /canvases/:id/rename — Rename Canvas

**Body** (`RenameCanvasDto`):

```json
{
  "name": "New Name",
  "description": "Optional new description"
}
```

`name` required; `description` optional.

**Response:** Updated Canvas (Prisma model).

---

### DELETE /canvases/:id — Delete Canvas

No body. **Response:** Deleted Canvas (Prisma model).  
Cascade deletes all nodes and edges.

---

## Node Type Mapping (Frontend → Backend)

| Frontend type | Backend NodeType |
|---------------|------------------|
| QuestionNode | QUESTION |
| ResponseNode | RESPONSE |
| LoadingNode | RESPONSE |
| ImageNode | IMAGE |
| CommentNode | COMMENT |
| NotesNode | NOTES |
| YoutubeNode | EMBED |
| *(unknown)* | TEXT |

---

## Error Responses

- **401 Unauthorized:** Missing or invalid JWT
- **404 Not Found:** Canvas not found or user does not own canvas
- **400 Bad Request:** Validation errors (class-validator)

---

## Implementation Files

| File | Purpose |
|------|---------|
| `canvases.controller.ts` | Route definitions, JwtAuthGuard |
| `canvases.service.ts` | Business logic, sync, spatial queries |
| `dto/sync-node.dto.ts` | SyncNodeItemDto, SyncEdgeItemDto, SyncCanvasDto |
| `dto/viewport-query.dto.ts` | minX, minY, maxX, maxY, tileIds |
| `dto/create-canvas.dto.ts` | name, description, viewportX, viewportY |
| `dto/rename-canvas.dto.ts` | name, description |

---

## Schema Migration

```bash
npx prisma db push
# or, if drift: npx prisma db push --accept-data-loss
npx prisma generate
```
