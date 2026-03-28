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
import { InviteCanvasDto } from './dto/invite-canvas.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@ApiTags('Canvas Shares')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('canvases/:id/members')
export class CanvasSharesController {
    constructor(private readonly canvasSharesService: CanvasSharesService) {}

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
    updateRole(
        @Req() req,
        @Param('id') canvasId: string,
        @Param('userId') targetUserId: string,
        @Body() dto: UpdateMemberRoleDto,
    ) {
        return this.canvasSharesService.updateMemberRole(
            req.user.userId,
            canvasId,
            targetUserId,
            dto,
        );
    }

    @Delete(':userId')
    @ApiOperation({ summary: 'Remove a collaborator from the canvas' })
    @ApiResponse({ status: 200, description: 'Member removed.' })
    removeMember(
        @Req() req,
        @Param('id') canvasId: string,
        @Param('userId') targetUserId: string,
    ) {
        return this.canvasSharesService.removeMember(
            req.user.userId,
            canvasId,
            targetUserId,
        );
    }

    @Post('accept')
    @ApiOperation({ summary: 'Accept a pending canvas invite' })
    @ApiResponse({ status: 200, description: 'Invite accepted.' })
    acceptInvite(@Req() req, @Param('id') canvasId: string) {
        return this.canvasSharesService.acceptInvite(req.user.userId, canvasId);
    }
}
