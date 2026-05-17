import {
    Controller,
    Post,
    Get,
    Patch,
    Delete,
    Body,
    Param,
    UseGuards,
    Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { PlanGuard } from '../../../common/plans/plan.guard';
import { RequireFeature, CheckLimit } from '../../../common/plans/plan.decorator';
import { CanvasSharesService } from './canvas-shares.service';
import { CanvasesGateway } from '../canvases.gateway';
import { InviteCanvasDto } from './dto/invite-canvas.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@ApiTags('Canvas Shares')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('canvases/:id/members')
export class CanvasSharesController {
    constructor(
        private readonly canvasSharesService: CanvasSharesService,
        private readonly canvasesGateway: CanvasesGateway,
    ) {}

    @Post('invite')
    @UseGuards(PlanGuard)
    @RequireFeature('collaboration')
    @CheckLimit('collaborators')
    @ApiOperation({ summary: 'Invite a user to collaborate on the canvas' })
    @ApiResponse({ status: 201, description: 'Invite sent or share created.' })
    invite(@Req() req, @Param('id') canvasId: string, @Body() dto: InviteCanvasDto) {
        return this.canvasSharesService.invite(req.user.userId, canvasId, dto);
    }

    @Get()
    @ApiOperation({ summary: 'List all collaborators of the canvas' })
    @ApiResponse({ status: 200, description: 'Members list returned.' })
    listMembers(@Req() req, @Param('id') canvasId: string) {
        return this.canvasSharesService.listMembers(req.user.userId, canvasId);
    }

    @Patch(':userId/role')
    @ApiOperation({ summary: 'Update a collaborator role (OWNER only)' })
    @ApiResponse({ status: 200, description: 'Role updated.' })
    async updateRole(
        @Req() req,
        @Param('id') canvasId: string,
        @Param('userId') targetUserId: string,
        @Body() dto: UpdateMemberRoleDto,
    ) {
        const result = await this.canvasSharesService.updateMemberRole(
            req.user.userId,
            canvasId,
            targetUserId,
            dto,
        );
        // Push the new role to the affected user's sockets so their UI re-evaluates
        // permissions immediately. Without this, a demoted editor would keep sending
        // /sync calls and hit 403s until they refresh.
        await this.canvasesGateway.notifyRoleChanged(canvasId, targetUserId, dto.role);
        return result;
    }

    @Delete(':userId')
    @ApiOperation({ summary: 'Remove a collaborator from the canvas' })
    @ApiResponse({ status: 200, description: 'Member removed.' })
    async removeMember(
        @Req() req,
        @Param('id') canvasId: string,
        @Param('userId') targetUserId: string,
    ) {
        const result = await this.canvasSharesService.removeMember(
            req.user.userId,
            canvasId,
            targetUserId,
        );
        await this.canvasesGateway.notifyMemberRemoved(canvasId, targetUserId);
        return result;
    }

    @Post('accept')
    @ApiOperation({ summary: 'Accept a pending canvas invite' })
    @ApiResponse({ status: 200, description: 'Invite accepted.' })
    acceptInvite(@Req() req, @Param('id') canvasId: string) {
        return this.canvasSharesService.acceptInvite(req.user.userId, canvasId);
    }
}
