import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    UseGuards,
    Req,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto, CreateReplyDto, UpdateReplyDto } from './dto/update-comment.dto';

@ApiTags('Canvas Comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('canvases/:canvasId/comments')
export class CommentsController {
    constructor(private readonly comments: CommentsService) {}

    @Get()
    @ApiOperation({ summary: 'List all comments on a canvas (with replies)' })
    list(@Req() req, @Param('canvasId') canvasId: string) {
        return this.comments.listForCanvas(req.user.userId, canvasId);
    }

    @Post()
    @ApiOperation({ summary: 'Create a comment pin on the canvas' })
    create(@Req() req, @Param('canvasId') canvasId: string, @Body() dto: CreateCommentDto) {
        return this.comments.create(req.user.userId, canvasId, dto);
    }

    @Patch(':commentId')
    @ApiOperation({ summary: 'Edit comment body or move pin (author only)' })
    update(
        @Req() req,
        @Param('canvasId') canvasId: string,
        @Param('commentId') commentId: string,
        @Body() dto: UpdateCommentDto,
    ) {
        return this.comments.update(req.user.userId, canvasId, commentId, dto);
    }

    @Delete(':commentId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft-delete a comment (author or canvas editor)' })
    remove(
        @Req() req,
        @Param('canvasId') canvasId: string,
        @Param('commentId') commentId: string,
    ) {
        return this.comments.remove(req.user.userId, canvasId, commentId);
    }

    @Post(':commentId/resolve')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Mark a comment as resolved' })
    resolve(
        @Req() req,
        @Param('canvasId') canvasId: string,
        @Param('commentId') commentId: string,
    ) {
        return this.comments.setResolved(req.user.userId, canvasId, commentId, true);
    }

    @Post(':commentId/reopen')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reopen a resolved comment' })
    reopen(
        @Req() req,
        @Param('canvasId') canvasId: string,
        @Param('commentId') commentId: string,
    ) {
        return this.comments.setResolved(req.user.userId, canvasId, commentId, false);
    }

    @Post(':commentId/replies')
    @ApiOperation({ summary: 'Reply to a comment' })
    addReply(
        @Req() req,
        @Param('canvasId') canvasId: string,
        @Param('commentId') commentId: string,
        @Body() dto: CreateReplyDto,
    ) {
        return this.comments.addReply(req.user.userId, canvasId, commentId, dto);
    }

    @Patch(':commentId/replies/:replyId')
    @ApiOperation({ summary: 'Edit a reply (author only)' })
    updateReply(
        @Req() req,
        @Param('canvasId') canvasId: string,
        @Param('commentId') commentId: string,
        @Param('replyId') replyId: string,
        @Body() dto: UpdateReplyDto,
    ) {
        return this.comments.updateReply(req.user.userId, canvasId, commentId, replyId, dto);
    }

    @Delete(':commentId/replies/:replyId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete a reply (author or canvas editor)' })
    removeReply(
        @Req() req,
        @Param('canvasId') canvasId: string,
        @Param('commentId') commentId: string,
        @Param('replyId') replyId: string,
    ) {
        return this.comments.removeReply(req.user.userId, canvasId, commentId, replyId);
    }
}
