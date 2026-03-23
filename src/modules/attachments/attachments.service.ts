import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { S3Service } from './s3.service';
import type { AttachmentType } from './attachments.constants';
import {
    ALLOWED_TYPES,
    EXTENSION_TO_TYPE,
    MAX_FILE_SIZE_BYTES,
} from './attachments.constants';
import * as path from 'path';

@Injectable()
export class AttachmentsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly s3: S3Service,
    ) {}

    /** Adds presigned download + optional preview URL for images (inline, for &lt;img&gt;). */
    private async attachUrls<T extends { key: string; filename: string; mimeType: string; type: AttachmentType }>(
        row: T,
    ) {
        const base = {
            ...row,
            downloadUrl: await this.s3.getPresignedUrl({
                key: row.key,
                expiresIn: 3600,
                filename: row.filename,
                disposition: 'attachment',
            }),
        };
        if (row.type === 'IMAGE' || row.mimeType.startsWith('image/')) {
            return {
                ...base,
                previewUrl: await this.s3.getPresignedUrl({
                    key: row.key,
                    expiresIn: 3600,
                    filename: row.filename,
                    disposition: 'inline',
                }),
            };
        }
        return base;
    }

    async upload(
        userId: string,
        file: Express.Multer.File,
        entityType?: string,
        entityId?: string,
    ) {
        if (!file?.buffer && !file?.originalname) {
            throw new BadRequestException('No file provided');
        }

        const buffer = file.buffer ?? (file as any).buffer;
        const originalname = file.originalname ?? (file as any).originalname;
        const mimetype = file.mimetype ?? (file as any).mimetype ?? 'application/octet-stream';

        if (!buffer || !originalname) {
            throw new BadRequestException('Invalid file upload');
        }

        const size = buffer.length;
        if (size > MAX_FILE_SIZE_BYTES) {
            throw new BadRequestException(
                `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
            );
        }

        const config = ALLOWED_TYPES[mimetype];
        const ext = path.extname(originalname).slice(1).toLowerCase();
        const typeFromExt = ext ? EXTENSION_TO_TYPE[ext] : null;

        let attachmentType: AttachmentType = 'OTHER';
        if (config) {
            if (size > config.maxSize) {
                throw new BadRequestException(
                    `File exceeds max size for ${mimetype}: ${config.maxSize / 1024 / 1024} MB`,
                );
            }
            attachmentType = config.type;
        } else if (typeFromExt) {
            attachmentType = typeFromExt;
        } else {
            throw new BadRequestException(
                `Unsupported file type: ${mimetype}. Allowed: images (jpeg, png, gif, webp, svg), PDF, CSV`,
            );
        }

        const key = this.s3.buildKey(userId, attachmentType, path.extname(originalname));

        await this.s3.upload({
            key,
            body: buffer,
            contentType: mimetype,
            metadata: {
                userId,
                originalName: originalname,
            },
        });

        const attachment = await this.prisma.attachment.create({
            data: {
                userId,
                key,
                filename: originalname,
                mimeType: mimetype,
                sizeBytes: size,
                type: attachmentType,
                entityType: entityType ?? null,
                entityId: entityId ?? null,
            },
        });

        return this.attachUrls(attachment);
    }

    async findAll(userId: string, entityType?: string, entityId?: string) {
        const where: any = { userId };
        if (entityType) where.entityType = entityType;
        if (entityId) where.entityId = entityId;

        const attachments = await this.prisma.attachment.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });

        return Promise.all(attachments.map((a) => this.attachUrls(a)));
    }

    async findOne(userId: string, id: string) {
        const attachment = await this.prisma.attachment.findUnique({
            where: { id },
        });

        if (!attachment) {
            throw new NotFoundException('Attachment not found');
        }
        if (attachment.userId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        return this.attachUrls(attachment);
    }

    async remove(userId: string, id: string) {
        const attachment = await this.prisma.attachment.findUnique({
            where: { id },
        });

        if (!attachment) {
            throw new NotFoundException('Attachment not found');
        }
        if (attachment.userId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        await this.s3.delete(attachment.key);
        await this.prisma.attachment.delete({ where: { id } });

        return { id, deleted: true };
    }
}
