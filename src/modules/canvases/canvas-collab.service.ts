import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CanvasOp } from './dto/canvas-op.dto';
import { computeTileIds } from './canvas-utils';

const FLUSH_INTERVAL_MS = 500;
const PRESENCE_TTL_SECONDS = 30;

interface PendingNodeState {
    clientId: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    zIndex?: number;
    style?: Record<string, unknown>;
}

export interface UserPresence {
    userId: string;
    name: string;
    color: string;
    cursor?: { x: number; y: number };
    selectedNodeIds?: string[];
    lastSeen: number;
}

@Injectable()
export class CanvasCollabService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(CanvasCollabService.name);

    /** Map<canvasId, Map<clientId, PendingNodeState>> */
    private pendingWrites = new Map<string, Map<string, PendingNodeState>>();
    private flushTimer: NodeJS.Timeout | null = null;

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
                // merge style fields so multiple style ops in one flush window combine
                map.set(op.nodeId, { ...existing, style: { ...(existing.style ?? {}), ...d.style } });
                break;
            }
            case 'node_zindex': {
                const d = op.data as { zIndex: number };
                map.set(op.nodeId, { ...existing, zIndex: d.zIndex });
                break;
            }
        }
    }

    async forceFlush(canvasId: string) {
        await this.flushCanvas(canvasId);
    }

    private async flushAll() {
        const ids = [...this.pendingWrites.keys()];
        if (!ids.length) return;
        await Promise.allSettled(ids.map(id => this.flushCanvas(id)));
    }

    private async flushCanvas(canvasId: string) {
        const writes = this.pendingWrites.get(canvasId);
        if (!writes || writes.size === 0) return;

        // Claim before async work to prevent double-flush
        this.pendingWrites.delete(canvasId);
        const nodes = [...writes.values()];

        try {
            await Promise.all(nodes.map(n => this.applyNodeUpdate(canvasId, n)));
            this.logger.debug(`[Collab] Flushed ${nodes.length} ops for canvas ${canvasId}`);
        } catch (err) {
            this.logger.error(`[Collab] Flush failed for ${canvasId}: ${err.message}`);
            // Re-queue only nodes not already superseded by a newer op
            const current = this.pendingWrites.get(canvasId) ?? new Map<string, PendingNodeState>();
            nodes.forEach(n => { if (!current.has(n.clientId)) current.set(n.clientId, n); });
            this.pendingWrites.set(canvasId, current);
        }
    }

    private async applyNodeUpdate(canvasId: string, state: PendingNodeState) {
        const data: Record<string, unknown> = {};

        if (state.zIndex !== undefined) data.zIndex = state.zIndex;
        if (state.style !== undefined) data.style = state.style;

        const hasPos = state.x !== undefined || state.y !== undefined;
        const hasSize = state.width !== undefined || state.height !== undefined;

        if (hasPos || hasSize) {
            // node_move / node_resize always provide full { x, y, width, height }
            // so we never need a DB read — just write directly
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
                // Partial position (only x or only y — unusual but safe to skip spatial recompute)
                if (state.x !== undefined) data.x = state.x;
                if (state.y !== undefined) data.y = state.y;
                if (state.width !== undefined) data.width = state.width;
                if (state.height !== undefined) data.height = state.height;
            }
        }

        if (!Object.keys(data).length) return;

        await this.prisma.node.updateMany({
            where: { canvasId, clientId: state.clientId },
            data,
        });
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
