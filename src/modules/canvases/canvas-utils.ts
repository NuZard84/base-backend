import { NodeType, NodeRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { SyncNodeItemDto } from './dto/sync-node.dto';

export const TILE_SIZE = 512;

const NODE_TYPE_MAP: Record<string, NodeType> = {
    QuestionNode: NodeType.QUESTION,
    ResponseNode: NodeType.RESPONSE,
    LoadingNode: NodeType.RESPONSE,
    ImageNode: NodeType.IMAGE,
    ImageGenNode: NodeType.IMAGE_GEN,
    CommentNode: NodeType.COMMENT,
    NotesNode: NodeType.NOTES,
    YoutubeNode: NodeType.EMBED,
    default: NodeType.TEXT,
};

export function computeTileIds(minX: number, minY: number, maxX: number, maxY: number): number[] {
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

export function mapNodeType(type?: string): NodeType {
    return type ? NODE_TYPE_MAP[type] ?? NODE_TYPE_MAP.default : NodeType.TEXT;
}

export function prepareNodeData(
    node: SyncNodeItemDto,
    canvasId: string,
): Prisma.NodeUncheckedCreateInput {
    const w = node.width ?? 360;
    const h = node.height ?? 240;
    const bboxMinX = node.x;
    const bboxMinY = node.y;
    const bboxMaxX = node.x + w;
    const bboxMaxY = node.y + h;
    const tileIdsArr = computeTileIds(bboxMinX, bboxMinY, bboxMaxX, bboxMaxY);
    const nodeType = mapNodeType(node.type);

    return {
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
}
