import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';
import { RenameCanvasDto } from './dto/rename-canvas.dto';
import { SyncCanvasDto } from './dto/sync-node.dto';
import { ViewportQueryDto } from './dto/viewport-query.dto';
import { NodeRole, NodeType } from '@prisma/client';

/** Tile size for spatial indexing (Figma-style grid) */
const TILE_SIZE = 512;

/** Map frontend node type to Prisma NodeType enum.
 * LoadingNode → RESPONSE: by sync time the node always has a response or error, never still loading. */
const NODE_TYPE_MAP: Record<string, NodeType> = {
    QuestionNode: NodeType.QUESTION,
    ResponseNode: NodeType.RESPONSE,
    LoadingNode: NodeType.RESPONSE, // Frontend uses LoadingNode; we persist as RESPONSE
    ImageNode: NodeType.IMAGE,
    CommentNode: NodeType.COMMENT,
    NotesNode: NodeType.NOTES,
    YoutubeNode: NodeType.EMBED,
    default: NodeType.TEXT,
};

/** Compute tile IDs for a bounding box (Figma-style tiling) */
function computeTileIds(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const tileXMin = Math.floor(minX / TILE_SIZE);
    const tileYMin = Math.floor(minY / TILE_SIZE);
    const tileXMax = Math.floor(maxX / TILE_SIZE);
    const tileYMax = Math.floor(maxY / TILE_SIZE);
    const ids: number[] = [];
    for (let ty = tileYMin; ty <= tileYMax; ty++) {
        for (let tx = tileXMin; tx <= tileXMax; tx++) {
            ids.push(ty * 10000 + tx);
        }
    }
    return ids;
}

@Injectable()
export class CanvasesService {
    private readonly logger = new Logger(CanvasesService.name);

    constructor(private prisma: PrismaService) {}

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
            where: { userId },
            select: {
                id: true,
                name: true,
                description: true,
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
        const canvas = await this.prisma.canvas.findFirst({
            where: { id, userId },
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
        await this.ensureCanvasOwnership(userId, canvasId);

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
     * Bulk sync nodes and edges. Atomic transaction.
     * - Full replace: removes nodes/edges not in payload
     * - Computes bbox + tileIds for spatial optimization
     */
    async sync(userId: string, canvasId: string, dto: SyncCanvasDto) {
        await this.ensureCanvasOwnership(userId, canvasId);

        const { nodes, edges, viewportX, viewportY, viewportZoom } = dto;

        this.logger.log(
            `[Sync] Triggered | canvasId=${canvasId} | userId=${userId} | ` +
                `nodes=${nodes.length} | edges=${edges.length} | ` +
                `viewport=[x:${viewportX ?? 'n/a'}, y:${viewportY ?? 'n/a'}, zoom:${viewportZoom ?? 'n/a'}]`,
        );
        if (nodes.length > 0) {
            const sample = nodes.slice(0, 2).map(
                (n) => `{id:${n.id}, x:${n.x}, y:${n.y}, type:${n.type ?? '?'}}`,
            );
            this.logger.debug(`[Sync] Node samples: ${sample.join(', ')}`);
        }

        return this.prisma.$transaction(async (tx) => {
            const existingNodes = await tx.node.findMany({
                where: { canvasId },
                select: { id: true, clientId: true },
            });

            const payloadClientIds = new Set(nodes.map((n) => n.id));
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

            for (const node of nodes) {
                const w = node.width ?? 360;
                const h = node.height ?? 240;
                const bboxMinX = node.x;
                const bboxMinY = node.y;
                const bboxMaxX = node.x + w;
                const bboxMaxY = node.y + h;
                const tileIdsArr = computeTileIds(bboxMinX, bboxMinY, bboxMaxX, bboxMaxY);
                const nodeType = node.type ? NODE_TYPE_MAP[node.type] ?? NODE_TYPE_MAP.default : NodeType.TEXT;

                const nodeData = {
                    canvasId,
                    clientId: node.id,
                    x: node.x,
                    y: node.y,
                    width: w,
                    height: h,
                    zIndex: node.zIndex ?? 0,
                    nodeType,
                    role: NodeRole.INPUT,
                    content: (node.data ?? {}) as object,
                    bboxMinX,
                    bboxMinY,
                    bboxMaxX,
                    bboxMaxY,
                    tileIds: tileIdsArr,
                };

                const upserted = await tx.node.upsert({
                    where: { canvasId_clientId: { canvasId, clientId: node.id } },
                    create: nodeData,
                    update: nodeData,
                });
                clientIdToNodeId.set(node.id, upserted.id);

                boundsMinX = Math.min(boundsMinX, bboxMinX);
                boundsMinY = Math.min(boundsMinY, bboxMinY);
                boundsMaxX = Math.max(boundsMaxX, bboxMaxX);
                boundsMaxY = Math.max(boundsMaxY, bboxMaxY);
            }

            await tx.edge.deleteMany({ where: { canvasId } });

            const validEdges = edges.filter(
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

            const nodeCount = nodes.length;
            const edgeCount = validEdges.length;

            const updateData: Record<string, unknown> = {
                nodeCount,
                edgeCount,
                viewportX: viewportX ?? undefined,
                viewportY: viewportY ?? undefined,
                viewportZoom: viewportZoom ?? undefined,
            };
            if (nodes.length > 0 && Number.isFinite(boundsMinX)) {
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
                `[Sync] Completed | canvasId=${canvasId} | nodesSaved=${nodeCount} | edgesSaved=${edgeCount}`,
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
        }, { timeout: 30000 });
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

        return this.prisma.canvas.delete({
            where: { id },
        });
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
