import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { S3Service } from '../attachments/s3.service';

const PAGE_SIZE = 24;

@Injectable()
export class GalleryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly s3: S3Service,
    ) {}

    async publish(
        userId: string,
        attachmentId: string,
        title?: string,
        prompt?: string,
    ) {
        const attachment = await this.prisma.attachment.findUnique({
            where: { id: attachmentId },
        });

        if (!attachment) throw new NotFoundException('Attachment not found');
        if (attachment.userId !== userId) throw new ForbiddenException('Access denied');
        const isMedia = attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/');
        if (!isMedia) {
            throw new BadRequestException('Only images and videos can be published to the gallery');
        }

        const updated = await this.prisma.attachment.update({
            where: { id: attachmentId },
            data: {
                isPublic: true,
                publishedAt: attachment.publishedAt ?? new Date(),
                title: title ?? attachment.title,
                prompt: prompt ?? attachment.prompt,
            },
            include: { user: { select: { id: true, name: true, image: true } } },
        });

        return { ...updated, url: await this.getUrl(updated.key, updated.mimeType) };
    }

    /**
     * Bulk-publish every AI-generated image/video on a canvas.
     *
     * Eligibility rules (mirror the per-node `canPublish` rule in the frontend):
     *  - Source must be IMAGE_GEN_RESULT or VIDEO node — anything else is skipped.
     *  - IMAGE_GEN_RESULT: only `tool` IN (null, '', 'Variant') are eligible.
     *    Skips: Upscale, Remove BG, Edit Text (mechanical), Pasted (reference).
     *  - IMAGE_GEN_RESULT must have a real attachment ref (non-empty `id` or `key`)
     *    and must not be still-loading or errored.
     *  - VIDEO: only nodes with status='done' and a real `s3Key`.
     *  - Final safety net: filters resolved attachments to image/* and video/* mime types.
     */
    async publishCanvasMedia(userId: string, canvasId: string) {
        const canvas = await this.prisma.canvas.findUnique({ where: { id: canvasId } });
        if (!canvas) throw new NotFoundException('Canvas not found');
        if (canvas.userId !== userId) throw new ForbiddenException('Access denied');

        const nodes = await this.prisma.node.findMany({
            where: { canvasId, nodeType: { in: ['IMAGE_GEN_RESULT', 'VIDEO'] as any } },
            select: { id: true, nodeType: true, content: true },
        });

        const keys = new Set<string>();
        const attachmentIds = new Set<string>();

        for (const n of nodes) {
            const content = (n.content ?? {}) as Record<string, unknown>;

            if (n.nodeType === ('IMAGE_GEN_RESULT' as any)) {
                // Skip in-flight or failed generations — no real attachment yet.
                if (content.isLoading === true) continue;
                if (content.generationError) continue;

                const tool = content.tool;
                const isOriginal = tool == null || tool === '';
                const isVariant = tool === 'Variant';
                if (!isOriginal && !isVariant) continue;

                const img = content.generatedImage as { id?: string; key?: string } | undefined;
                // Skip nodes whose image has no real persisted attachment
                // (e.g. some Remove-BG outputs use empty id/key).
                if (!img?.id && !img?.key) continue;
                if (img.id) attachmentIds.add(img.id);
                if (img.key) keys.add(img.key);
            } else if (n.nodeType === ('VIDEO' as any)) {
                // Only finished renders. status is the source of truth; s3Key
                // existence is a secondary guard.
                if (content.status && content.status !== 'done') continue;
                const s3Key = content.s3Key;
                if (typeof s3Key !== 'string' || s3Key.length === 0) continue;
                keys.add(s3Key);
            }
        }

        if (keys.size === 0 && attachmentIds.size === 0) {
            return { publishedCount: 0, attachmentIds: [] };
        }

        const candidates = await this.prisma.attachment.findMany({
            where: {
                userId,
                OR: [
                    ...(keys.size > 0 ? [{ key: { in: [...keys] } }] : []),
                    ...(attachmentIds.size > 0 ? [{ id: { in: [...attachmentIds] } }] : []),
                ],
            },
            select: { id: true, mimeType: true, isPublic: true },
        });

        // Final mime-type gate — defense in depth in case a stray PDF/CSV row
        // slipped into the candidate set via a corrupt key/id reference.
        const eligible = candidates.filter(
            a => a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/'),
        );

        const toPublish = eligible.filter(a => !a.isPublic);
        if (toPublish.length === 0) {
            return { publishedCount: 0, attachmentIds: [] };
        }

        const now = new Date();
        const result = await this.prisma.attachment.updateMany({
            where: {
                id: { in: toPublish.map(a => a.id) },
                userId,
                isPublic: false,
            },
            data: { isPublic: true, publishedAt: now },
        });

        return { publishedCount: result.count, attachmentIds: toPublish.map(a => a.id) };
    }

    async getStatus(userId: string, attachmentId: string) {
        const attachment = await this.prisma.attachment.findUnique({
            where: { id: attachmentId },
            select: { userId: true, isPublic: true },
        });
        if (!attachment || attachment.userId !== userId) {
            return { exists: false, isPublic: false };
        }
        return { exists: true, isPublic: attachment.isPublic };
    }

    async unpublish(userId: string, attachmentId: string) {
        const attachment = await this.prisma.attachment.findUnique({
            where: { id: attachmentId },
        });

        if (!attachment) throw new NotFoundException('Attachment not found');
        if (attachment.userId !== userId) throw new ForbiddenException('Access denied');

        await this.prisma.attachment.update({
            where: { id: attachmentId },
            data: { isPublic: false },
        });

        return { id: attachmentId, unpublished: true };
    }

    async getPublicGallery(cursor?: string, type?: string) {
        const where: any = { isPublic: true };
        if (type === 'image') where.mimeType = { startsWith: 'image/' };
        if (type === 'video') where.mimeType = { startsWith: 'video/' };

        const items = await this.prisma.attachment.findMany({
            where,
            orderBy: { publishedAt: 'desc' },
            take: PAGE_SIZE + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
                user: { select: { id: true, name: true, image: true } },
            },
        });

        const hasMore = items.length > PAGE_SIZE;
        const page = hasMore ? items.slice(0, PAGE_SIZE) : items;
        const nextCursor = hasMore ? page[page.length - 1].id : null;

        const withUrls = await Promise.all(
            page.map(async (item) => ({
                ...item,
                url: await this.getUrl(item.key, item.mimeType),
            })),
        );

        return { items: withUrls, nextCursor, hasMore };
    }

    async getItem(id: string) {
        const item = await this.prisma.attachment.findUnique({
            where: { id },
            include: { user: { select: { id: true, name: true, image: true } } },
        });

        if (!item || !item.isPublic) throw new NotFoundException('Gallery item not found');

        await this.prisma.attachment.update({
            where: { id },
            data: { viewsCount: { increment: 1 } },
        });

        return { ...item, url: await this.getUrl(item.key, item.mimeType) };
    }

    private async getUrl(key: string, mimeType: string): Promise<string> {
        return this.s3.getPresignedUrl({
            key,
            expiresIn: 60 * 60 * 24 * 7,
            disposition: mimeType.startsWith('video/') ? 'inline' : 'inline',
        });
    }
}
