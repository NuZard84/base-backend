import {
    Controller,
    Post,
    Delete,
    Get,
    Param,
    Body,
    Query,
    UseGuards,
    Req,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { GalleryService } from './gallery.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

@ApiTags('Gallery')
@Controller('gallery')
export class GalleryController {
    constructor(private readonly galleryService: GalleryService) {}

    @Post('publish/:attachmentId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Publish an attachment to the public gallery' })
    publish(
        @Req() req,
        @Param('attachmentId') attachmentId: string,
        @Body() body: { title?: string; prompt?: string },
    ) {
        return this.galleryService.publish(req.user.userId, attachmentId, body.title, body.prompt);
    }

    @Get('status/:attachmentId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Check publish status of an attachment' })
    getStatus(@Req() req, @Param('attachmentId') attachmentId: string) {
        return this.galleryService.getStatus(req.user.userId, attachmentId);
    }

    @Post('publish-canvas/:canvasId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Bulk-publish every image/video on a canvas to the gallery' })
    publishCanvas(@Req() req, @Param('canvasId') canvasId: string) {
        return this.galleryService.publishCanvasMedia(req.user.userId, canvasId);
    }

    @Delete('unpublish/:attachmentId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Unpublish an attachment from the public gallery' })
    unpublish(@Req() req, @Param('attachmentId') attachmentId: string) {
        return this.galleryService.unpublish(req.user.userId, attachmentId);
    }

    @Get()
    @ApiOperation({ summary: 'Get public gallery feed' })
    @ApiQuery({ name: 'cursor', required: false })
    @ApiQuery({ name: 'type', required: false, enum: ['image', 'video'] })
    getGallery(@Query('cursor') cursor?: string, @Query('type') type?: string) {
        return this.galleryService.getPublicGallery(cursor, type);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a single gallery item' })
    getItem(@Param('id') id: string) {
        return this.galleryService.getItem(id);
    }
}
