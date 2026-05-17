import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';
import { RenameCanvasDto } from './dto/rename-canvas.dto';
import {
    SyncCanvasDto,
    SyncEdgeItemDto,
    SyncNodeItemDto,
} from './dto/sync-node.dto';
import { ViewportQueryDto } from './dto/viewport-query.dto';
import { CanvasRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { CanvasSharesService } from './canvas-shares/canvas-shares.service';
import { CanvasesGateway } from './canvases.gateway';
import { prepareNodeData } from './canvas-utils';
import { PlanService } from '../../common/plans/plan.service';

function hasDeltaPayload(dto: SyncCanvasDto): boolean {
    return (
        (dto.nodesUpdated?.length ?? 0) > 0 ||
        (dto.nodesDeleted?.length ?? 0) > 0 ||
        (dto.edgesAdded?.length ?? 0) > 0 ||
        (dto.edgesDeleted?.length ?? 0) > 0
    );
}

function isFullSync(dto: SyncCanvasDto): boolean {
    return dto.nodes !== undefined && dto.edges !== undefined;
}

/** True when the payload carries only viewport position — no node/edge changes. */
function isViewportOnly(dto: SyncCanvasDto): boolean {
    return (
        !hasDeltaPayload(dto) &&
        !isFullSync(dto) &&
        (dto.viewportX != null || dto.viewportY != null || dto.viewportZoom != null)
    );
}

@Injectable()
export class CanvasesService {
    private readonly logger = new Logger(CanvasesService.name);

    constructor(
        private prisma: PrismaService,
        private canvasSharesService: CanvasSharesService,
        private canvasesGateway: CanvasesGateway,
        private planService: PlanService,
    ) {}

    private generateRandomString(length: number): string {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    async create(userId: string, createDto: CreateCanvasDto) {
        let name = createDto.name;
        let description = createDto.description;

        if (!name) {
            const randomSuffix = this.generateRandomString(4);
            name = `PROOJ-${randomSuffix}`;
        }

        if (!description) {
            description = `${name}'s description`;
        }

        return this.prisma.canvas.create({
            data: {
                userId,
                name,
                description,
                viewportX: createDto.viewportX,
                viewportY: createDto.viewportY,
            },
        });
    }

    async findAll(userId: string) {
        return this.prisma.canvas.findMany({
            where: { 
                OR: [
                    { userId },
                    { shares: { some: { userId, status: 'ACTIVE' } } }
                ]
            },
            select: {
                id: true,
                name: true,
                description: true,
                userId: true,
                nodeCount: true,
                edgeCount: true,
                boundsMinX: true,
                boundsMinY: true,
                boundsMaxX: true,
                boundsMaxY: true,
                viewportX: true,
                viewportY: true,
                viewportZoom: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
        });
    }

    async findOne(userId: string, id: string) {
        await this.canvasSharesService.ensureCanvasAccess(userId, id, CanvasRole.VIEWER);

        const canvas = await this.prisma.canvas.findUnique({
            where: { id },
            include: {
                nodes: {
                    orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
                },
                edges: true,
            },
        });

        if (!canvas) {
            throw new NotFoundException(`Canvas with ID ${id} not found`);
        }

        return canvas;
    }

    /**
     * Fetch nodes in viewport (spatial query) - optimized for large canvases.
     * Uses bbox overlap: bboxMinX < maxX AND bboxMaxX > minX AND bboxMinY < maxY AND bboxMaxY > minY
     */
    async findNodesInViewport(userId: string, canvasId: string, query: ViewportQueryDto) {
        await this.canvasSharesService.ensureCanvasAccess(userId, canvasId, CanvasRole.VIEWER);

        const { minX, minY, maxX, maxY, tileIds } = query;

        if (tileIds?.length) {
            return this.prisma.node.findMany({
                where: {
                    canvasId,
                    tileIds: { hasSome: tileIds },
                },
                select: {
                    id: true,
                    clientId: true,
                    x: true,
                    y: true,
                    width: true,
                    height: true,
                    zIndex: true,
                    nodeType: true,
                    content: true,
                    metadata: true,
                    style: true,
                    bboxMinX: true,
                    bboxMinY: true,
                    bboxMaxX: true,
                    bboxMaxY: true,
                },
                orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
            });
        }

        if (minX == null || minY == null || maxX == null || maxY == null) {
            return this.prisma.node.findMany({
                where: { canvasId },
                select: {
                    id: true,
                    clientId: true,
                    x: true,
                    y: true,
                    width: true,
                    height: true,
                    zIndex: true,
                    nodeType: true,
                    content: true,
                    metadata: true,
                    style: true,
                },
                orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
            });
        }

        return this.prisma.node.findMany({
            where: {
                canvasId,
                bboxMinX: { lt: maxX },
                bboxMaxX: { gt: minX },
                bboxMinY: { lt: maxY },
                bboxMaxY: { gt: minY },
            },
            select: {
                id: true,
                clientId: true,
                x: true,
                y: true,
                width: true,
                height: true,
                zIndex: true,
                nodeType: true,
                content: true,
                metadata: true,
                style: true,
            },
            orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
        });
    }

    /**
     * Sync nodes and edges. Supports two modes:
     * - FULL SYNC: nodes + edges present → full replace (fallback for initial load, recovery)
     * - DELTA SYNC: nodesUpdated | nodesDeleted | edgesAdded | edgesDeleted → touch only changed rows
     */
    async sync(userId: string, canvasId: string, dto: SyncCanvasDto) {
        await this.canvasSharesService.ensureCanvasAccess(userId, canvasId, CanvasRole.EDITOR);

        // Check node-per-canvas limit when adding new nodes
        const hasNewNodes =
            (dto.nodesUpdated?.length ?? 0) > 0 || (dto.nodes?.length ?? 0) > 0;
        if (hasNewNodes) {
            await this.planService.checkLimit(userId, 'nodes_per_canvas', { canvasId });
        }

        let result;
        if (isFullSync(dto)) {
            result = await this.runFullSync(userId, canvasId, dto);
        } else if (hasDeltaPayload(dto)) {
            result = await this.runDeltaSync(userId, canvasId, dto);
        } else if (isViewportOnly(dto)) {
            // Viewport-only update — no node/edge changes to process.
            // Happens when the client has no delta baseline (e.g. first save
            // after the last node is deleted). Persist the viewport position
            // and return early without broadcasting (nothing changed for peers).
            await this.prisma.canvas.update({
                where: { id: canvasId },
                data: {
                    viewportX: dto.viewportX ?? undefined,
                    viewportY: dto.viewportY ?? undefined,
                    viewportZoom: dto.viewportZoom ?? undefined,
                },
            });
            return { viewport: { viewportX: dto.viewportX, viewportY: dto.viewportY, viewportZoom: dto.viewportZoom } };
        } else {
            throw new BadRequestException(
                'Either nodes+edges (full sync) or nodesUpdated/nodesDeleted/edgesAdded/edgesDeleted (delta sync) required',
            );
        }

        // Broadcast to other clients silently in background
        this.canvasesGateway.broadcastCanvasUpdate(canvasId, result, userId);

        return result;
    }

    /**
     * Full sync: full replace. Atomic transaction. Used for initial load, recovery, import.
     */
    private async runFullSync(userId: string, canvasId: string, dto: SyncCanvasDto) {
        const { nodes, edges, viewportX, viewportY, viewportZoom } = dto;
        const nodesArr = nodes ?? [];
        const edgesArr = edges ?? [];

        this.logger.log(
            `[Sync] FULL | canvasId=${canvasId} | userId=${userId} | ` +
                `nodes=${nodesArr.length} | edges=${edgesArr.length} | ` +
                `viewport=[x:${viewportX ?? 'n/a'}, y:${viewportY ?? 'n/a'}, zoom:${viewportZoom ?? 'n/a'}]`,
        );
        if (nodesArr.length > 0) {
            const sample = nodesArr.slice(0, 2).map(
                (n) => `{id:${n.id}, x:${n.x}, y:${n.y}, type:${n.type ?? '?'}}`,
            );
            this.logger.debug(`[Sync] Node samples: ${sample.join(', ')}`);
        }

        return this.prisma.$transaction(async (tx) => {
            const existingNodes = await tx.node.findMany({
                where: { canvasId },
                select: { id: true, clientId: true },
            });

            const payloadClientIds = new Set(nodesArr.map((n) => n.id));
            const toDeleteIds = existingNodes
                .filter((n) => n.clientId && !payloadClientIds.has(n.clientId))
                .map((n) => n.id);

            if (toDeleteIds.length) {
                await tx.edge.deleteMany({
                    where: {
                        canvasId,
                        OR: [
                            { sourceNodeId: { in: toDeleteIds } },
                            { targetNodeId: { in: toDeleteIds } },
                        ],
                    },
                });
                await tx.node.deleteMany({ where: { id: { in: toDeleteIds } } });
            }

            const clientIdToNodeId = new Map<string, string>(
                existingNodes.filter((n) => n.clientId).map((n) => [n.clientId!, n.id]),
            );

            let boundsMinX = Infinity;
            let boundsMinY = Infinity;
            let boundsMaxX = -Infinity;
            let boundsMaxY = -Infinity;

            // Parallel node upserts (reduces latency from N round-trips to ~1)
            if (nodesArr.length > 0) {
                const upsertResults = await Promise.all(
                    nodesArr.map(async (node) => {
                        const nodeData = prepareNodeData(node, canvasId);
                        const upserted = await tx.node.upsert({
                            where: { canvasId_clientId: { canvasId, clientId: node.id } },
                            create: nodeData,
                            update: nodeData as Prisma.NodeUncheckedUpdateInput,
                        });
                        return { nodeData, clientId: node.id, nodeId: upserted.id };
                    }),
                );
                for (const { nodeData, clientId, nodeId } of upsertResults) {
                    clientIdToNodeId.set(clientId, nodeId);
                    const bboxMinX = nodeData.bboxMinX as number;
                    const bboxMinY = nodeData.bboxMinY as number;
                    const bboxMaxX = nodeData.bboxMaxX as number;
                    const bboxMaxY = nodeData.bboxMaxY as number;
                    boundsMinX = Math.min(boundsMinX, bboxMinX);
                    boundsMinY = Math.min(boundsMinY, bboxMinY);
                    boundsMaxX = Math.max(boundsMaxX, bboxMaxX);
                    boundsMaxY = Math.max(boundsMaxY, bboxMaxY);
                }
            }

            await tx.edge.deleteMany({ where: { canvasId } });

            const validEdges = edgesArr.filter(
                (e) => clientIdToNodeId.has(e.source) && clientIdToNodeId.has(e.target),
            );

            if (validEdges.length) {
                await tx.edge.createMany({
                    data: validEdges.map((e) => ({
                        canvasId,
                        sourceNodeId: clientIdToNodeId.get(e.source)!,
                        targetNodeId: clientIdToNodeId.get(e.target)!,
                        metadata: (e.metadata ?? {}) as object,
                    })),
                    skipDuplicates: true,
                });
            }

            const nodeCount = nodesArr.length;
            const edgeCount = validEdges.length;

            const updateData: Record<string, unknown> = {
                nodeCount,
                edgeCount,
                viewportX: viewportX ?? undefined,
                viewportY: viewportY ?? undefined,
                viewportZoom: viewportZoom ?? undefined,
            };
            if (nodesArr.length > 0 && Number.isFinite(boundsMinX)) {
                updateData.boundsMinX = boundsMinX;
                updateData.boundsMinY = boundsMinY;
                updateData.boundsMaxX = boundsMaxX;
                updateData.boundsMaxY = boundsMaxY;
            }

            await tx.canvas.update({
                where: { id: canvasId },
                data: updateData,
            });

            const updatedEdges = await tx.edge.findMany({
                where: { canvasId },
                include: {
                    sourceNode: { select: { clientId: true } },
                    targetNode: { select: { clientId: true } },
                },
            });

            this.logger.log(
                `[Sync] FULL Completed | canvasId=${canvasId} | nodesSaved=${nodeCount} | edgesSaved=${edgeCount}`,
            );

            return {
                nodeCount,
                edgeCount,
                nodeIdMap: Object.fromEntries(clientIdToNodeId),
                edges: updatedEdges.map((e) => ({
                    id: e.id,
                    source: e.sourceNode.clientId,
                    target: e.targetNode.clientId,
                })),
            };
        }, { timeout: 25000 });
    }

    /**
     * Delta sync: touch only changed rows. Short transaction, few queries.
     */
    private async runDeltaSync(userId: string, canvasId: string, dto: SyncCanvasDto) {
        const { nodesUpdated, nodesDeleted, edgesAdded, edgesDeleted, viewportX, viewportY, viewportZoom } = dto;
        const nodesArr = nodesUpdated ?? [];
        const nodesDel = nodesDeleted ?? [];
        const edgesAdd = edgesAdded ?? [];
        const edgesDel = edgesDeleted ?? [];

        this.logger.log(
            `[Sync] DELTA | canvasId=${canvasId} | userId=${userId} | ` +
                `nodesUpdated=${nodesArr.length} | nodesDeleted=${nodesDel.length} | ` +
                `edgesAdded=${edgesAdd.length} | edgesDeleted=${edgesDel.length}`,
        );

        return this.runWithDeadlockRetry(() => this.prisma.$transaction(async (tx) => {
            const canvas = await tx.canvas.findUnique({
                where: { id: canvasId },
                select: { nodeCount: true, edgeCount: true },
            });
            if (!canvas) {
                throw new NotFoundException(`Canvas not found`);
            }

            let nodesCreated = 0;
            let nodesDeletedCount = 0;

            // --- 1. Node deletions ---
            if (nodesDel.length > 0) {
                const nodesToDelete = await tx.node.findMany({
                    where: { canvasId, clientId: { in: nodesDel } },
                    select: { id: true },
                });
                const ids = nodesToDelete.map((n) => n.id);

                if (ids.length > 0) {
                    await tx.edge.deleteMany({
                        where: {
                            canvasId,
                            OR: [
                                { sourceNodeId: { in: ids } },
                                { targetNodeId: { in: ids } },
                            ],
                        },
                    });
                    await tx.node.deleteMany({ where: { id: { in: ids } } });
                    nodesDeletedCount = ids.length;
                }
            }

            // --- 2. Upsert all nodesUpdated in parallel (reduces latency from N round-trips to ~1) ---
            const clientIdToNodeId = new Map<string, string>();

            // Pre-populate map with existing nodes so edge references to unmodified nodes resolve correctly.
            // This is critical when only new child nodes (e.g. NapkinResponseNode) are in nodesUpdated
            // but their parent (e.g. NapkinNode) already exists in the DB and isn't in this delta.
            if (edgesAdd.length > 0) {
                const existingNodes = await tx.node.findMany({
                    where: { canvasId, clientId: { not: null } },
                    select: { id: true, clientId: true },
                });
                existingNodes.forEach((n) => { if (n.clientId) clientIdToNodeId.set(n.clientId, n.id); });
            }

            if (nodesArr.length > 0) {
                // Sort by clientId so two concurrent transactions queue lock requests in
                // the same order — prevents the deadlock that used to happen when
                // Promise.all submitted upserts in input order (different across requests).
                // Prisma serializes queries on a single tx connection, so sorting the input
                // is enough; keeping Promise.all preserves pipelined throughput so the
                // transaction stays well under its 25s timeout even under network jitter.
                const sortedNodes = [...nodesArr].sort((a, b) => a.id.localeCompare(b.id));
                const upsertResults = await Promise.all(
                    sortedNodes.map(async (node) => {
                        const nodeData = prepareNodeData(node, canvasId);
                        const upserted = await tx.node.upsert({
                            where: { canvasId_clientId: { canvasId, clientId: node.id } },
                            create: nodeData,
                            update: nodeData as Prisma.NodeUncheckedUpdateInput,
                        });
                        return [node.id, upserted.id] as const;
                    }),
                );
                upsertResults.forEach(([clientId, nodeId]) => clientIdToNodeId.set(clientId, nodeId));
            }

            // --- 3. Edge deletions ---
            if (edgesDel.length > 0) {
                await tx.edge.deleteMany({
                    where: { id: { in: edgesDel }, canvasId },
                });
            }

            // --- 6. Edge additions ---
            if (edgesAdd.length > 0) {
                const validEdges = edgesAdd.filter(
                    (e) => clientIdToNodeId.has(e.source) && clientIdToNodeId.has(e.target),
                );
                if (validEdges.length > 0) {
                    await tx.edge.createMany({
                        data: validEdges.map((e) => ({
                            canvasId,
                            sourceNodeId: clientIdToNodeId.get(e.source)!,
                            targetNodeId: clientIdToNodeId.get(e.target)!,
                            metadata: (e.metadata ?? {}) as object,
                        })),
                        skipDuplicates: true,
                    });
                }
            }

            // --- 7. Viewport update ---
            const viewportData: Record<string, unknown> = {};
            if (viewportX !== undefined) viewportData.viewportX = viewportX;
            if (viewportY !== undefined) viewportData.viewportY = viewportY;
            if (viewportZoom !== undefined) viewportData.viewportZoom = viewportZoom;

            // --- 8. Canvas counts (run in parallel to save a round-trip) ---
            const [nodeCount, edgeCount] = await Promise.all([
                tx.node.count({ where: { canvasId } }),
                tx.edge.count({ where: { canvasId } }),
            ]);

            await tx.canvas.update({
                where: { id: canvasId },
                data: {
                    ...viewportData,
                    nodeCount: Math.max(0, nodeCount),
                    edgeCount,
                },
            });

            this.logger.log(
                `[Sync] DELTA Completed | canvasId=${canvasId} | nodesUpserted=${nodesArr.length} | nodesDeleted=${nodesDeletedCount} | nodeCount=${nodeCount} | edgeCount=${edgeCount}`,
            );

            return {
                nodeIdMap: Object.fromEntries(clientIdToNodeId),
                updatedNodes: nodesDel, // Keep legacy behavior for response 
                // Adding the actual full delta payload for WebSockets
                delta: {
                    nodesUpdated: nodesArr,
                    nodesDeleted: nodesDel,
                    edgesAdded: edgesAdd,
                    edgesDeleted: edgesDel,
                },
                viewport:
                    viewportData.viewportX !== undefined ||
                    viewportData.viewportY !== undefined ||
                    viewportData.viewportZoom !== undefined
                        ? { viewportX, viewportY, viewportZoom }
                        : undefined,
                nodeCount: Math.max(0, nodeCount),
                edgeCount,
            };
        }, { timeout: 25000 }));
    }

    /**
     * Retry a transactional operation when PostgreSQL aborts it with a deadlock (40P01).
     * Deadlocks are an expected outcome of concurrent writes touching overlapping rows;
     * Postgres picks one transaction as the victim and the app is expected to retry it.
     * Exponential backoff with jitter avoids two retrying clients colliding again.
     */
    private async runWithDeadlockRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
        let lastErr: unknown;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                const msg = (err as Error)?.message ?? '';
                const isDeadlock = msg.includes('deadlock detected') || msg.includes('40P01');
                if (!isDeadlock || attempt === maxRetries - 1) throw err;
                lastErr = err;
                const delay = 40 * Math.pow(2, attempt) + Math.random() * 60;
                this.logger.warn(`[Sync] Deadlock on attempt ${attempt + 1}, retrying in ${Math.round(delay)}ms`);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
        throw lastErr;
    }

    async rename(userId: string, id: string, renameDto: RenameCanvasDto) {
        const canvas = await this.prisma.canvas.findFirst({
            where: { id, userId },
        });

        if (!canvas) {
            throw new NotFoundException(`Canvas with ID ${id} not found`);
        }

        return this.prisma.canvas.update({
            where: { id },
            data: {
                name: renameDto.name,
                description: renameDto.description,
            },
        });
    }

    async remove(userId: string, id: string) {
        const canvas = await this.prisma.canvas.findFirst({
            where: { id, userId },
        });

        if (!canvas) {
            throw new NotFoundException(`Canvas with ID ${id} not found`);
        }

        const deleted = await this.prisma.canvas.delete({
            where: { id },
        });

        // Broadcast only after successful DB delete — avoids false deletion
        // events if the delete throws (FK constraint, Neon timeout, etc.).
        // Peers can still receive the event even after the room dissolves
        // because we emit to the room name directly via server.to().
        this.canvasesGateway.broadcastCanvasDeleted(id, userId);

        return deleted;
    }

    private async ensureCanvasOwnership(userId: string, canvasId: string): Promise<void> {
        const canvas = await this.prisma.canvas.findFirst({
            where: { id: canvasId, userId },
        });
        if (!canvas) {
            throw new NotFoundException(`Canvas with ID ${canvasId} not found`);
        }
    }
}
