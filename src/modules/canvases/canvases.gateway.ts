import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { CanvasSharesService } from './canvas-shares/canvas-shares.service';
import { CanvasCollabService, UserPresence } from './canvas-collab.service';
import { PrismaService } from 'prisma/prisma.service';
import { CanvasRole } from '@prisma/client';
import type {
    CanvasOpPayload,
    CursorMovePayload,
    SelectionChangePayload,
    ForceFlushPayload,
    JoinCanvasPayload,
    SyncSincePayload,
} from './dto/canvas-op.dto';

// cors, transports, ping settings are configured at the server level via SocketIoAdapter.
// No namespace declared here — the default namespace '/' is used and rooms (canvas:{id})
// provide all the per-canvas isolation needed. A named namespace caused "Invalid namespace"
// errors because NestJS can call createIOServer() multiple times, and a namespace registered
// on the second Server instance is unreachable (the first instance wins the HTTP upgrade).
@WebSocketGateway()
export class CanvasesGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(CanvasesGateway.name);

    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
        private canvasSharesService: CanvasSharesService,
        private collabService: CanvasCollabService,
        private prisma: PrismaService,
    ) {}

    afterInit() {
        // Wire the sync-error callback so the collab service can broadcast
        // to a canvas room when all DB flush retries are exhausted.
        this.collabService.onSyncError = (payload) => {
            this.server.to(`canvas:${payload.canvasId}`).emit('sync_error', payload);
        };
    }

    // ── Connection lifecycle ──────────────────────────────────────────────────

    async handleConnection(client: Socket) {
        try {
            const token =
                client.handshake.auth?.token ||
                client.handshake.headers['authorization']?.split(' ')[1];
            if (!token) { client.disconnect(); return; }

            const payload = this.jwtService.verify(token, {
                secret: this.configService.get<string>('JWT_SECRET'),
            });

            client.data.userId = payload.sub as string;
            client.data.canvasIds = new Set<string>();
            this.logger.log(`Connected: ${client.id} (user=${payload.sub})`);
        } catch (e) {
            this.logger.warn(`Auth failed for ${client.id}: ${e.message}`);
            client.disconnect();
        }
    }

    async handleDisconnect(client: Socket) {
        const userId = client.data.userId as string | undefined;
        const canvasIds = client.data.canvasIds as Set<string> | undefined;

        if (userId && canvasIds) {
            for (const canvasId of canvasIds) {
                void this.collabService.removePresence(canvasId, userId);
                void this.collabService.forceFlush(canvasId);
                this.server.to(`canvas:${canvasId}`).emit('presence_left', { canvasId, userId });
            }
        }
        this.logger.log(`Disconnected: ${client.id}`);
    }

    // ── Room management ───────────────────────────────────────────────────────

    /**
     * Join a canvas room and optionally catch up on missed ops.
     *
     * Client sends: { canvasId, lastSeq? }
     *   - lastSeq: the last serverSeq the client saw (omit on first join)
     *
     * Server responds with:
     *   - 'joined'        { canvasId, currentSeq }
     *   - 'presence_list' { canvasId, users }
     *   - 'ops_catchup'   { canvasId, ops }   ← only when lastSeq is provided
     */
    @SubscribeMessage('join_canvas')
    async handleJoinCanvas(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: JoinCanvasPayload | string,
    ) {
        // Accept both old string format and new object format
        const canvasId = typeof payload === 'string' ? payload : payload.canvasId;
        const lastSeq  = typeof payload === 'string' ? undefined : payload.lastSeq;

        const userId = client.data.userId as string;
        if (!userId || !canvasId) return;

        try {
            await this.canvasSharesService.ensureCanvasAccess(userId, canvasId, CanvasRole.VIEWER);
        } catch {
            return { event: 'error', data: { message: 'Cannot join canvas room' } };
        }

        const roomName = `canvas:${canvasId}`;
        await client.join(roomName);
        (client.data.canvasIds as Set<string>).add(canvasId);

        // Run user lookup, seq fetch, and presence set in parallel
        const [user, currentSeq] = await Promise.all([
            this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
            this.collabService.getCurrentSeq(canvasId),
        ]);

        const presence = await this.collabService.setPresence(canvasId, userId, {
            name: user?.name ?? 'Unknown',
        });

        // Send presence list to the joiner
        const sockets = await this.server.in(roomName).fetchSockets();
        const uniquePeerIds = [
            ...new Set(
                sockets
                    .map(s => s.data.userId as string)
                    .filter(id => id && id !== userId),
            ),
        ];
        const peers = await Promise.all(
            uniquePeerIds.map(id => this.collabService.getPresence(canvasId, id)),
        );
        client.emit('presence_list', {
            canvasId,
            users: peers.filter(Boolean) as UserPresence[],
        });

        // Catch up on missed ops if the client provided lastSeq
        if (lastSeq !== undefined && lastSeq < currentSeq) {
            const missedOps = await this.collabService.getOpsSince(canvasId, lastSeq);
            if (missedOps.length > 0) {
                client.emit('ops_catchup', { canvasId, ops: missedOps });
            }
        }

        // Notify existing peers
        client.broadcast.to(roomName).emit('presence_joined', { canvasId, user: presence });

        this.logger.log(`${client.id} joined canvas:${canvasId} (seq=${currentSeq})`);
        return { event: 'joined', data: { canvasId, currentSeq } };
    }

    @SubscribeMessage('leave_canvas')
    async handleLeaveCanvas(
        @ConnectedSocket() client: Socket,
        @MessageBody() canvasId: string,
    ) {
        if (!canvasId) return;
        const userId = client.data.userId as string;
        const roomName = `canvas:${canvasId}`;

        await client.leave(roomName);
        (client.data.canvasIds as Set<string>).delete(canvasId);

        void this.collabService.removePresence(canvasId, userId);
        void this.collabService.forceFlush(canvasId);

        this.server.to(roomName).emit('presence_left', { canvasId, userId });
        this.logger.log(`${client.id} left canvas:${canvasId}`);
    }

    // ── Real-time op relay ────────────────────────────────────────────────────

    /**
     * Relay a canvas op to peers, assign a server sequence number, append to
     * op-log for catch-up, and queue for debounced DB persistence.
     *
     * Client sends:  { canvasId, op: { type, nodeId, data, seq? } }
     * Peers receive: 'op_relayed'  { canvasId, senderUserId, op, serverSeq }
     * Sender gets:   'op_ack'      { canvasId, clientSeq, serverSeq }
     */
    @SubscribeMessage('canvas_op')
    async handleCanvasOp(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: CanvasOpPayload,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !payload?.canvasId || !payload?.op) return;

        const { canvasId, op } = payload;

        // Assign server sequence number (Redis INCR, non-blocking on failure)
        const serverSeq = await this.collabService.nextSeq(canvasId);

        // 1. Relay to peers immediately with serverSeq so they can detect gaps
        client.broadcast.to(`canvas:${canvasId}`).emit('op_relayed', {
            canvasId,
            senderUserId: userId,
            op,
            serverSeq,
        });

        // 2. Acknowledge to sender so they know the op reached the server
        client.emit('op_ack', {
            canvasId,
            clientSeq: op.seq,
            serverSeq,
        });

        // 3. Append to op-log so reconnecting clients can catch up (non-blocking)
        void this.collabService.appendOpLog(canvasId, {
            serverSeq,
            timestamp: Date.now(),
            senderUserId: userId,
            op,
        });

        // 4. Queue for debounced DB persistence
        this.collabService.queueOp(canvasId, op);
    }

    /**
     * Catch-up request: client sends its last known serverSeq and receives
     * all ops it missed. Use this after a reconnect if join_canvas didn't
     * include lastSeq, or to explicitly request a replay.
     *
     * Client sends:  { canvasId, lastSeq }
     * Client gets:   'ops_catchup' { canvasId, ops, currentSeq }
     */
    @SubscribeMessage('sync_since')
    async handleSyncSince(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: SyncSincePayload,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !payload?.canvasId) return;

        const [missedOps, currentSeq] = await Promise.all([
            this.collabService.getOpsSince(payload.canvasId, payload.lastSeq),
            this.collabService.getCurrentSeq(payload.canvasId),
        ]);

        client.emit('ops_catchup', {
            canvasId: payload.canvasId,
            ops: missedOps,
            currentSeq,
        });
    }

    /**
     * Cursor relay — ephemeral, no DB, no op-log.
     * High-frequency (~60fps); keep it as lean as possible.
     */
    @SubscribeMessage('cursor_move')
    handleCursorMove(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: CursorMovePayload,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !payload?.canvasId) return;

        client.broadcast.to(`canvas:${payload.canvasId}`).emit('cursor_updated', {
            canvasId: payload.canvasId,
            userId,
            x: payload.x,
            y: payload.y,
        });
    }

    /**
     * Selection relay — relay immediately, update presence async.
     */
    @SubscribeMessage('selection_change')
    handleSelectionChange(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: SelectionChangePayload,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !payload?.canvasId) return;

        client.broadcast.to(`canvas:${payload.canvasId}`).emit('selection_updated', {
            canvasId: payload.canvasId,
            userId,
            selectedNodeIds: payload.selectedNodeIds,
        });

        void this.collabService.setPresence(payload.canvasId, userId, {
            selectedNodeIds: payload.selectedNodeIds,
        });
    }

    /**
     * Force-flush pending DB writes immediately (call on mouse-up / explicit save).
     */
    @SubscribeMessage('canvas_force_flush')
    async handleForceFlush(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: ForceFlushPayload,
    ) {
        const userId = client.data.userId as string;
        if (!userId || !payload?.canvasId) return;

        await this.collabService.forceFlush(payload.canvasId);
        return { event: 'flushed', data: { canvasId: payload.canvasId } };
    }

    // ── Called by CanvasesService after HTTP sync ─────────────────────────────

    broadcastCanvasUpdate(
        canvasId: string,
        payload: {
            delta?: {
                nodesUpdated?: unknown[];
                nodesDeleted?: string[];
                edgesAdded?: unknown[];
                edgesDeleted?: string[];
            };
            nodeCount?: number;
            edgeCount?: number;
        },
        senderUserId?: string,
    ) {
        this.server.to(`canvas:${canvasId}`).emit('canvas_updated', {
            canvasId,
            senderUserId,
            delta: payload.delta ?? null,
            nodeCount: payload.nodeCount,
            edgeCount: payload.edgeCount,
        });
    }
}
