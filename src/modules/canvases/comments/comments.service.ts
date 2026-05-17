import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CanvasRole } from '@prisma/client';
import { CanvasSharesService } from '../canvas-shares/canvas-shares.service';
import { CanvasesGateway } from '../canvases.gateway';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto, CreateReplyDto, UpdateReplyDto } from './dto/update-comment.dto';

/**
 * Permission model (intentionally less strict than node edits — comments are a
 * collaboration primitive, not destructive changes to the canvas itself):
 *
 *   - list / read:         VIEWER+ (anyone with canvas access)
 *   - create comment:      COMMENTOR+
 *   - reply to comment:    COMMENTOR+
 *   - edit own comment:    author only
 *   - delete own comment:  author only
 *   - delete any comment:  OWNER or EDITOR  (moderation)
 *   - resolve / reopen:    COMMENTOR+ if author; OWNER or EDITOR for any
 *
 * Soft-delete (`deletedAt`) is used so we keep an audit trail.
 */
@Injectable()
export class CommentsService {
    constructor(
        private prisma: PrismaService,
        private shares: CanvasSharesService,
        private gateway: CanvasesGateway,
    ) {}

    // ── Listing ───────────────────────────────────────────────────────────────

    async listForCanvas(userId: string, canvasId: string) {
        await this.shares.ensureCanvasAccess(userId, canvasId, CanvasRole.VIEWER);

        const comments = await this.prisma.comment.findMany({
            where: { canvasId, deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: {
                author: { select: { id: true, name: true, email: true, image: true } },
                replies: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'asc' },
                    include: {
                        author: { select: { id: true, name: true, email: true, image: true } },
                    },
                },
            },
        });

        return comments;
    }

    // ── Comments CRUD ─────────────────────────────────────────────────────────

    async create(userId: string, canvasId: string, dto: CreateCommentDto) {
        await this.shares.ensureCanvasAccess(userId, canvasId, CanvasRole.COMMENTOR);

        const comment = await this.prisma.comment.create({
            data: {
                canvasId,
                authorId: userId,
                body: dto.body,
                x: dto.x,
                y: dto.y,
                anchorNodeId: dto.anchorNodeId,
            },
            include: {
                author: { select: { id: true, name: true, email: true, image: true } },
                replies: true,
            },
        });

        this.gateway.broadcastCommentEvent(canvasId, 'comment_added', { comment });
        return comment;
    }

    async update(userId: string, canvasId: string, commentId: string, dto: UpdateCommentDto) {
        const comment = await this.getOwnedComment(userId, canvasId, commentId);
        // Only the author can edit body / move the pin. Moderators can delete but not rewrite.
        if (comment.authorId !== userId) {
            throw new ForbiddenException('Only the author can edit this comment');
        }

        const updated = await this.prisma.comment.update({
            where: { id: commentId },
            data: {
                body: dto.body ?? undefined,
                x: dto.x ?? undefined,
                y: dto.y ?? undefined,
            },
            include: {
                author: { select: { id: true, name: true, email: true, image: true } },
                replies: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'asc' },
                    include: {
                        author: { select: { id: true, name: true, email: true, image: true } },
                    },
                },
            },
        });

        this.gateway.broadcastCommentEvent(canvasId, 'comment_updated', { comment: updated });
        return updated;
    }

    async remove(userId: string, canvasId: string, commentId: string) {
        const comment = await this.findCommentOrThrow(canvasId, commentId);
        const role = await this.shares.getEffectiveRole(userId, canvasId);
        if (!role) throw new ForbiddenException('No access');

        const isAuthor = comment.authorId === userId;
        const isModerator = role === CanvasRole.OWNER || role === CanvasRole.EDITOR;
        if (!isAuthor && !isModerator) {
            throw new ForbiddenException('Only the author or a canvas editor can delete this comment');
        }

        await this.prisma.comment.update({
            where: { id: commentId },
            data: { deletedAt: new Date() },
        });

        this.gateway.broadcastCommentEvent(canvasId, 'comment_deleted', { commentId });
        return { deleted: true, id: commentId };
    }

    async setResolved(userId: string, canvasId: string, commentId: string, resolved: boolean) {
        const comment = await this.findCommentOrThrow(canvasId, commentId);
        const role = await this.shares.getEffectiveRole(userId, canvasId);
        if (!role) throw new ForbiddenException('No access');

        const isAuthor = comment.authorId === userId;
        const isModerator = role === CanvasRole.OWNER || role === CanvasRole.EDITOR;
        const canCommentAtAll = ['OWNER', 'EDITOR', 'COMMENTOR'].includes(role);

        // Anyone with COMMENTOR+ access can resolve their own; only moderators
        // can resolve someone else's. Reopening follows the same rule.
        if (!canCommentAtAll) throw new ForbiddenException('Read-only viewers cannot resolve comments');
        if (!isAuthor && !isModerator) {
            throw new ForbiddenException('Only the author or a canvas editor can resolve this');
        }

        const updated = await this.prisma.comment.update({
            where: { id: commentId },
            data: {
                resolved,
                resolvedAt: resolved ? new Date() : null,
                resolvedBy: resolved ? userId : null,
            },
            include: {
                author: { select: { id: true, name: true, email: true, image: true } },
                replies: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'asc' },
                    include: {
                        author: { select: { id: true, name: true, email: true, image: true } },
                    },
                },
            },
        });

        this.gateway.broadcastCommentEvent(canvasId, 'comment_resolved', { comment: updated });
        return updated;
    }

    // ── Replies ───────────────────────────────────────────────────────────────

    async addReply(userId: string, canvasId: string, commentId: string, dto: CreateReplyDto) {
        await this.shares.ensureCanvasAccess(userId, canvasId, CanvasRole.COMMENTOR);
        await this.findCommentOrThrow(canvasId, commentId);

        const reply = await this.prisma.commentReply.create({
            data: {
                commentId,
                authorId: userId,
                body: dto.body,
            },
            include: {
                author: { select: { id: true, name: true, email: true, image: true } },
            },
        });

        this.gateway.broadcastCommentEvent(canvasId, 'comment_reply_added', {
            commentId,
            reply,
        });
        return reply;
    }

    async updateReply(userId: string, canvasId: string, commentId: string, replyId: string, dto: UpdateReplyDto) {
        const reply = await this.prisma.commentReply.findUnique({
            where: { id: replyId },
            include: { comment: true },
        });
        if (!reply || reply.deletedAt || reply.comment.canvasId !== canvasId || reply.commentId !== commentId) {
            throw new NotFoundException('Reply not found');
        }
        if (reply.authorId !== userId) {
            throw new ForbiddenException('Only the author can edit this reply');
        }

        const updated = await this.prisma.commentReply.update({
            where: { id: replyId },
            data: { body: dto.body },
            include: {
                author: { select: { id: true, name: true, email: true, image: true } },
            },
        });

        this.gateway.broadcastCommentEvent(canvasId, 'comment_reply_updated', {
            commentId,
            reply: updated,
        });
        return updated;
    }

    async removeReply(userId: string, canvasId: string, commentId: string, replyId: string) {
        const reply = await this.prisma.commentReply.findUnique({
            where: { id: replyId },
            include: { comment: true },
        });
        if (!reply || reply.deletedAt || reply.comment.canvasId !== canvasId || reply.commentId !== commentId) {
            throw new NotFoundException('Reply not found');
        }

        const role = await this.shares.getEffectiveRole(userId, canvasId);
        if (!role) throw new ForbiddenException('No access');

        const isAuthor = reply.authorId === userId;
        const isModerator = role === CanvasRole.OWNER || role === CanvasRole.EDITOR;
        if (!isAuthor && !isModerator) {
            throw new ForbiddenException('Only the author or a canvas editor can delete this reply');
        }

        await this.prisma.commentReply.update({
            where: { id: replyId },
            data: { deletedAt: new Date() },
        });

        this.gateway.broadcastCommentEvent(canvasId, 'comment_reply_deleted', {
            commentId,
            replyId,
        });
        return { deleted: true, id: replyId };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async findCommentOrThrow(canvasId: string, commentId: string) {
        const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
        if (!comment || comment.deletedAt || comment.canvasId !== canvasId) {
            throw new NotFoundException('Comment not found');
        }
        return comment;
    }

    /** Returns the comment after verifying the user has at least view access to the canvas. */
    private async getOwnedComment(userId: string, canvasId: string, commentId: string) {
        await this.shares.ensureCanvasAccess(userId, canvasId, CanvasRole.COMMENTOR);
        return this.findCommentOrThrow(canvasId, commentId);
    }
}
