import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CanvasRole, ShareStatus } from '@prisma/client';
import { InviteCanvasDto } from './dto/invite-canvas.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

const ROLE_RANK: Record<CanvasRole, number> = {
    OWNER: 4,
    EDITOR: 3,
    COMMENTOR: 2,
    VIEWER: 1,
};

@Injectable()
export class CanvasSharesService {
    constructor(private prisma: PrismaService) {}

    /** Resolve the effective role of a user for a given canvas.
     *  Owner always returns OWNER regardless of shares.
     *  Returns null if no access. */
    async getEffectiveRole(
        userId: string,
        canvasId: string,
    ): Promise<CanvasRole | null> {
        const canvas = await this.prisma.canvas.findUnique({
            where: { id: canvasId },
            select: { userId: true },
        });
        if (!canvas) return null;
        if (canvas.userId === userId) return CanvasRole.OWNER;

        const share = await this.prisma.canvasShare.findUnique({
            where: { canvasId_userId: { canvasId, userId } },
            select: { role: true, status: true },
        });
        if (!share || share.status !== ShareStatus.ACTIVE) return null;
        return share.role;
    }

    /** Assert the user has at least the given minimum role. Throws if not. */
    async ensureCanvasAccess(
        userId: string,
        canvasId: string,
        minRole: CanvasRole = CanvasRole.VIEWER,
    ): Promise<void> {
        const role = await this.getEffectiveRole(userId, canvasId);
        if (!role) {
            const exists = await this.prisma.canvas.findUnique({
                where: { id: canvasId },
                select: { id: true },
            });
            if (!exists) throw new NotFoundException('Canvas not found');
            throw new ForbiddenException('You do not have access to this canvas');
        }
        if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
            throw new ForbiddenException('Insufficient permissions');
        }
    }

    /** Check if the user has at least VIEWER access (no exception, returns bool). */
    async canAccess(userId: string, canvasId: string): Promise<boolean> {
        const role = await this.getEffectiveRole(userId, canvasId);
        return role !== null;
    }

    /** Invite a user by email. Creates a PENDING share. If user not found, returns a token-based link payload. */
    async invite(
        inviterUserId: string,
        canvasId: string,
        dto: InviteCanvasDto,
    ) {
        // Only OWNER or EDITOR can invite
        await this.ensureCanvasAccess(inviterUserId, canvasId, CanvasRole.EDITOR);

        const canvas = await this.prisma.canvas.findUnique({
            where: { id: canvasId },
            select: { id: true, name: true, userId: true },
        });
        if (!canvas) throw new NotFoundException('Canvas not found');

        // Find invited user
        const invitedUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
            select: { id: true, email: true, name: true },
        });

        if (!invitedUser) {
            // User not registered — return a shareable link payload (no DB record created for non-users)
            return {
                type: 'link_only',
                canvasId,
                email: dto.email,
                role: dto.role ?? CanvasRole.EDITOR,
                message: 'User not found. Share the invite link and they can join after registration.',
            };
        }

        // Cannot invite canvas owner
        if (invitedUser.id === canvas.userId) {
            throw new ConflictException('Cannot invite the canvas owner');
        }

        // Upsert share (update role/status if a record already exists)
        const share = await this.prisma.canvasShare.upsert({
            where: { canvasId_userId: { canvasId, userId: invitedUser.id } },
            create: {
                canvasId,
                userId: invitedUser.id,
                role: dto.role ?? CanvasRole.EDITOR,
                status: ShareStatus.ACTIVE, // auto-accept for registered users
                invitedBy: inviterUserId,
            },
            update: {
                role: dto.role ?? CanvasRole.EDITOR,
                status: ShareStatus.ACTIVE,
                invitedBy: inviterUserId,
                acceptedAt: new Date(),
            },
            include: {
                user: { select: { id: true, email: true, name: true, image: true } },
            },
        });

        return {
            type: 'user_invited',
            share,
        };
    }

    /** List all active or pending members of a canvas. */
    async listMembers(requestingUserId: string, canvasId: string) {
        await this.ensureCanvasAccess(requestingUserId, canvasId, CanvasRole.VIEWER);

        const canvas = await this.prisma.canvas.findUnique({
            where: { id: canvasId },
            select: {
                userId: true,
                user: { select: { id: true, email: true, name: true, image: true } },
            },
        });
        if (!canvas) throw new NotFoundException('Canvas not found');

        const shares = await this.prisma.canvasShare.findMany({
            where: { canvasId, status: { not: ShareStatus.REMOVED } },
            include: {
                user: { select: { id: true, email: true, name: true, image: true } },
            },
            orderBy: { invitedAt: 'asc' },
        });

        // Prepend owner as synthetic entry
        const members = [
            {
                userId: canvas.user.id,
                email: canvas.user.email,
                name: canvas.user.name,
                image: canvas.user.image,
                role: CanvasRole.OWNER,
                status: ShareStatus.ACTIVE,
                isOwner: true,
            },
            ...shares.map((s) => ({
                userId: s.user.id,
                email: s.user.email,
                name: s.user.name,
                image: s.user.image,
                role: s.role,
                status: s.status,
                isOwner: false,
                invitedAt: s.invitedAt,
                acceptedAt: s.acceptedAt,
            })),
        ];

        return { members, canvasId };
    }

    /** Update a member's role. Only OWNER can do this. */
    async updateMemberRole(
        requestingUserId: string,
        canvasId: string,
        targetUserId: string,
        dto: UpdateMemberRoleDto,
    ) {
        await this.ensureCanvasAccess(requestingUserId, canvasId, CanvasRole.OWNER);

        const share = await this.prisma.canvasShare.findUnique({
            where: { canvasId_userId: { canvasId, userId: targetUserId } },
        });
        if (!share) throw new NotFoundException('Member not found');

        return this.prisma.canvasShare.update({
            where: { canvasId_userId: { canvasId, userId: targetUserId } },
            data: { role: dto.role },
            include: {
                user: { select: { id: true, email: true, name: true, image: true } },
            },
        });
    }

    /** Remove a member from the canvas. Owner can remove anyone; editors can remove themselves. */
    async removeMember(
        requestingUserId: string,
        canvasId: string,
        targetUserId: string,
    ) {
        const requesterRole = await this.getEffectiveRole(requestingUserId, canvasId);
        if (!requesterRole) throw new ForbiddenException('No access');

        const isSelf = requestingUserId === targetUserId;
        const isOwner = requesterRole === CanvasRole.OWNER;

        if (!isSelf && !isOwner) {
            throw new ForbiddenException('Only the owner can remove other members');
        }

        const share = await this.prisma.canvasShare.findUnique({
            where: { canvasId_userId: { canvasId, userId: targetUserId } },
        });
        if (!share) throw new NotFoundException('Member not found');

        await this.prisma.canvasShare.update({
            where: { canvasId_userId: { canvasId, userId: targetUserId } },
            data: { status: ShareStatus.REMOVED },
        });

        return { removed: true, userId: targetUserId };
    }

    /** Accept a pending invite. */
    async acceptInvite(userId: string, canvasId: string) {
        const share = await this.prisma.canvasShare.findUnique({
            where: { canvasId_userId: { canvasId, userId } },
        });
        if (!share) throw new NotFoundException('Invite not found');
        if (share.status === ShareStatus.REMOVED) {
            throw new ForbiddenException('This invite has been revoked');
        }
        if (share.status === ShareStatus.ACTIVE) {
            return { alreadyActive: true };
        }

        return this.prisma.canvasShare.update({
            where: { canvasId_userId: { canvasId, userId } },
            data: { status: ShareStatus.ACTIVE, acceptedAt: new Date() },
        });
    }
}
