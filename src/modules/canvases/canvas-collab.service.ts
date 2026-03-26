import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CanvasOp, OpLogEntry } from './dto/canvas-op.dto';
import { computeTileIds } from './canvas-utils';

const FLUSH_INTERVAL_MS = 500;
const PRESENCE_TTL_SECONDS = 30;
const OPLOG_MAX_SIZE = 500;     // keep last 500 ops per canvas in Redis
const OPLOG_TTL_SECONDS = 7200; // 2 hours — enough for brief disconnects
const MAX_FLUSH_RETRIES = 3;
const FLUSH_RETRY_BASE_MS = 200;

interface PendingNodeState {
    clientId: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    zIndex?: number;
    /** style ops are accumulated separately so they can be merged at DB level */
    styleOp?: Record<string, unknown>;
    /** node_data ops — merged so rapid updates combine within flush window */
    contentOp?: Record<string, unknown>;
}

export interface UserPresence {
    userId: string;
    name: string;
    color: string;
    cursor?: { x: number; y: number };
    selectedNodeIds?: string[];
    lastSeen: number;
}

/** Emitted to a canvas room when all retries for a flush are exhausted */
export interface SyncErrorPayload {
    canvasId: string;
    affectedNodeIds: string[];
    message: string;
}

@Injectable()
export class CanvasCollabService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(CanvasCollabService.name);

    /** Map<canvasId, Map<clientId, PendingNodeState>> */
    private pendingWrites = new Map<string, Map<string, PendingNodeState>>();
    private flushTimer: NodeJS.Timeout | null = null;

    /** Callback injected by gateway to broadcast sync errors to a canvas room */
    onSyncError?: (payload: SyncErrorPayload) => void;

    private readonly COLORS = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    ];

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    onModuleInit() {
        this.flushTimer = setInterval(() => void this.flushAll(), FLUSH_INTERVAL_MS);
    }

    onModuleDestroy() {
        if (this.flushTimer) clearInterval(this.flushTimer);
        void this.flushAll();
    }

    // ── Op sequencing ─────────────────────────────────────────────────────────

    /**
     * Atomically increment and return the next server sequence number for a canvas.
     * Used to totally order all ops so clients can detect gaps and catch up.
     */
    async nextSeq(canvasId: string): Promise<number> {
        try {
            return await this.redis.incr(`canvas:${canvasId}:seq`);
        } catch {
            // Redis unavailable — return 0 so the op still goes through,
            // just without sequencing guarantees.
            return 0;
        }
    }

    async getCurrentSeq(canvasId: string): Promise<number> {
        try {
            const raw = await this.redis.get(`canvas:${canvasId}:seq`);
            return raw ? parseInt(raw, 10) : 0;
        } catch {
            return 0;
        }
    }

    // ── Op log ────────────────────────────────────────────────────────────────

    /**
     * Append an op to the canvas op-log in Redis.
     * Trims to OPLOG_MAX_SIZE so memory stays bounded.
     * The TTL is refreshed on every write so active canvases never expire.
     */
    async appendOpLog(canvasId: string, entry: OpLogEntry): Promise<void> {
        const key = `canvas:${canvasId}:oplog`;
        try {
            await this.redis.rpush(key, JSON.stringify(entry));
            await this.redis.ltrim(key, -OPLOG_MAX_SIZE, -1);
            await this.redis.expire(key, OPLOG_TTL_SECONDS);
        } catch {
            // Non-critical — catch-up will just fall back to a full HTTP sync
        }
    }

    /**
     * Return all ops with serverSeq > lastSeq.
     * Called on reconnect so the client can replay what it missed.
     */
    async getOpsSince(canvasId: string, lastSeq: number): Promise<OpLogEntry[]> {
        try {
            const raw = await this.redis.lrange(`canvas:${canvasId}:oplog`, 0, -1);
            return raw
                .map(s => JSON.parse(s) as OpLogEntry)
                .filter(e => e.serverSeq > lastSeq);
        } catch {
            return [];
        }
    }

    // ── Write buffer ──────────────────────────────────────────────────────────

    queueOp(canvasId: string, op: CanvasOp) {
        if (!this.pendingWrites.has(canvasId)) {
            this.pendingWrites.set(canvasId, new Map());
        }
        const map = this.pendingWrites.get(canvasId)!;
        const existing: PendingNodeState = map.get(op.nodeId) ?? { clientId: op.nodeId };

        switch (op.type) {
            case 'node_move':
            case 'node_resize': {
                const d = op.data as { x: number; y: number; width: number; height: number };
                map.set(op.nodeId, { ...existing, x: d.x, y: d.y, width: d.width, height: d.height });
                break;
            }
            case 'node_style': {
                const d = op.data as { style: Record<string, unknown> };
                // Merge style fields within the flush window so rapid style changes
                // from the same client combine. Cross-client merging is done at DB level.
                map.set(op.nodeId, {
                    ...existing,
                    styleOp: { ...(existing.styleOp ?? {}), ...d.style },
                });
                break;
            }
            case 'node_zindex': {
                const d = op.data as { zIndex: number };
                map.set(op.nodeId, { ...existing, zIndex: d.zIndex });
                break;
            }
            case 'node_data': {
                // Merge content fields so rapid updates combine within the flush window
                map.set(op.nodeId, {
                    ...existing,
                    contentOp: { ...(existing.contentOp ?? {}), ...op.data },
                });
                break;
            }
        }
    }

    async forceFlush(canvasId: string) {
        await this.flushCanvas(canvasId, 0);
    }

    private async flushAll() {
        const ids = [...this.pendingWrites.keys()];
        if (!ids.length) return;
        await Promise.allSettled(ids.map(id => this.flushCanvas(id, 0)));
    }

    private async flushCanvas(canvasId: string, attempt: number) {
        const writes = this.pendingWrites.get(canvasId);
        if (!writes || writes.size === 0) return;

        // Claim before async work to prevent double-flush
        this.pendingWrites.delete(canvasId);
        const nodes = [...writes.values()];

        try {
            await Promise.all(nodes.map(n => this.applyNodeUpdate(canvasId, n)));
            this.logger.debug(`[Collab] Flushed ${nodes.length} ops for canvas ${canvasId}`);
        } catch (err) {
            this.logger.error(
                `[Collab] Flush failed for ${canvasId} (attempt ${attempt + 1}): ${err.message}`,
            );

            if (attempt < MAX_FLUSH_RETRIES - 1) {
                // Exponential backoff retry: 200ms, 400ms, 800ms
                const delay = FLUSH_RETRY_BASE_MS * Math.pow(2, attempt);
                setTimeout(() => {
                    // Re-queue only nodes not superseded by a newer op in the meantime
                    const current = this.pendingWrites.get(canvasId) ?? new Map<string, PendingNodeState>();
                    nodes.forEach(n => { if (!current.has(n.clientId)) current.set(n.clientId, n); });
                    this.pendingWrites.set(canvasId, current);
                    void this.flushCanvas(canvasId, attempt + 1);
                }, delay);
            } else {
                // All retries exhausted — notify the canvas room so the frontend
                // can trigger a full HTTP sync as fallback
                this.logger.error(
                    `[Collab] All retries exhausted for canvas ${canvasId}. Emitting sync_error.`,
                );
                this.onSyncError?.({
                    canvasId,
                    affectedNodeIds: nodes.map(n => n.clientId),
                    message: 'Real-time sync failed after retries. Please re-save.',
                });
            }
        }
    }

    private async applyNodeUpdate(canvasId: string, state: PendingNodeState) {
        // ── Style: use PostgreSQL JSONB merge operator (||) for atomic field-level merge.
        // This means User A changing `fill` and User B changing `stroke` concurrently
        // both survive — neither overwrites the other's field.
        if (state.styleOp && Object.keys(state.styleOp).length > 0) {
            await this.prisma.$executeRaw`
                UPDATE "nodes"
                SET style = COALESCE(style, '{}'::jsonb) || ${JSON.stringify(state.styleOp)}::jsonb
                WHERE "canvasId" = ${canvasId} AND "clientId" = ${state.clientId}
            `;
        }

        // ── Content (node_data): merge changed fields into the content JSONB column
        if (state.contentOp && Object.keys(state.contentOp).length > 0) {
            await this.prisma.$executeRaw`
                UPDATE "nodes"
                SET content = COALESCE(content, '{}'::jsonb) || ${JSON.stringify(state.contentOp)}::jsonb
                WHERE "canvasId" = ${canvasId} AND "clientId" = ${state.clientId}
            `;
        }

        // ── Position / size / zIndex: build a flat update object
        const data: Record<string, unknown> = {};
        if (state.zIndex !== undefined) data.zIndex = state.zIndex;

        if (
            state.x !== undefined &&
            state.y !== undefined &&
            state.width !== undefined &&
            state.height !== undefined
        ) {
            const { x, y, width: w, height: h } = state;
            data.x = x;
            data.y = y;
            data.width = w;
            data.height = h;
            data.bboxMinX = x;
            data.bboxMinY = y;
            data.bboxMaxX = x + w;
            data.bboxMaxY = y + h;
            data.tileIds = computeTileIds(x, y, x + w, y + h);
        } else {
            if (state.x !== undefined) data.x = state.x;
            if (state.y !== undefined) data.y = state.y;
            if (state.width !== undefined) data.width = state.width;
            if (state.height !== undefined) data.height = state.height;
        }

        if (Object.keys(data).length > 0) {
            await this.prisma.node.updateMany({
                where: { canvasId, clientId: state.clientId },
                data,
            });
        }
    }

    // ── Presence ──────────────────────────────────────────────────────────────

    async setPresence(
        canvasId: string,
        userId: string,
        partial: Partial<Omit<UserPresence, 'userId'>>,
    ): Promise<UserPresence> {
        const key = `canvas:${canvasId}:presence:${userId}`;
        let existing: UserPresence | null = null;
        try {
            const raw = await this.redis.get(key);
            existing = raw ? (JSON.parse(raw) as UserPresence) : null;
        } catch {}

        const presence: UserPresence = {
            userId,
            name: partial.name ?? existing?.name ?? 'Unknown',
            color: existing?.color ?? this.assignColor(userId),
            cursor: partial.cursor ?? existing?.cursor,
            selectedNodeIds: partial.selectedNodeIds ?? existing?.selectedNodeIds,
            lastSeen: Date.now(),
        };

        try {
            await this.redis.set(key, JSON.stringify(presence), PRESENCE_TTL_SECONDS);
        } catch {}

        return presence;
    }

    async getPresence(canvasId: string, userId: string): Promise<UserPresence | null> {
        try {
            const raw = await this.redis.get(`canvas:${canvasId}:presence:${userId}`);
            return raw ? (JSON.parse(raw) as UserPresence) : null;
        } catch {
            return null;
        }
    }

    async removePresence(canvasId: string, userId: string) {
        try {
            await this.redis.del(`canvas:${canvasId}:presence:${userId}`);
        } catch {}
    }

    private assignColor(userId: string): string {
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            hash = (hash * 31 + userId.charCodeAt(i)) | 0;
        }
        return this.COLORS[Math.abs(hash) % this.COLORS.length];
    }
}
