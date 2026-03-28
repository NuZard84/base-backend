import {
    Controller,
    Post,
    Get,
    Delete,
    Param,
    Body,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    Req,
    Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { AttachmentsService } from './attachments.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PlanGuard } from '../../common/plans/plan.guard';
import { CheckLimit } from '../../common/plans/plan.decorator';
import { PlanService } from '../../common/plans/plan.service';
import { RESOURCE_TYPES } from '../../common/plans/plan-config';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { QueryAttachmentsDto } from './dto/query-attachments.dto';
import { MAX_FILE_SIZE_BYTES } from './attachments.constants';

const FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / 1024 / 1024;

@ApiTags('Attachments')
@ApiBearerAuth()
@Controller('attachments')
export class AttachmentsController {
    constructor(
        private readonly attachmentsService: AttachmentsService,
        private readonly planService: PlanService,
    ) {}

    @Post('upload')
    @UseGuards(JwtAuthGuard, PlanGuard)
    @CheckLimit('storage')
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: MAX_FILE_SIZE_BYTES },
        }),
    )
    @ApiOperation({
        summary: 'Upload a file attachment',
        description: `Upload PDF, CSV, or images (jpeg, png, gif, webp, svg). Max ${FILE_SIZE_MB} MB per file.`,
    })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary' },
                entityType: { type: 'string', example: 'canvas' },
                entityId: { type: 'string', example: 'uuid' },
            },
        },
    })
    @ApiResponse({ status: 201, description: 'File uploaded successfully.' })
    @ApiResponse({ status: 400, description: 'Invalid file type or size.' })
    async upload(
        @Req() req,
        @UploadedFile() file: Express.Multer.File,
        @Body() dto?: UploadAttachmentDto,
    ) {
        const result = await this.attachmentsService.upload(
            req.user.userId,
            file,
            dto?.entityType,
            dto?.entityId,
        );
        // Log file upload usage
        await this.planService.logUsage(req.user.userId, RESOURCE_TYPES.FILE_UPLOAD, 1, {
            filename: file.originalname,
            sizeBytes: file.size,
        });
        return result;
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'List attachments for the current user' })
    @ApiResponse({ status: 200, description: 'Return list of attachments with presigned download URLs.' })
    findAll(@Req() req, @Query() query: QueryAttachmentsDto) {
        return this.attachmentsService.findAll(
            req.user.userId,
            query.entityType,
            query.entityId,
        );
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get attachment by ID with download URL' })
    @ApiResponse({ status: 200, description: 'Return attachment metadata and presigned download URL.' })
    @ApiResponse({ status: 404, description: 'Attachment not found.' })
    findOne(@Req() req, @Param('id') id: string) {
        return this.attachmentsService.findOne(req.user.userId, id);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Delete an attachment' })
    @ApiResponse({ status: 200, description: 'Attachment deleted.' })
    @ApiResponse({ status: 404, description: 'Attachment not found.' })
    remove(@Req() req, @Param('id') id: string) {
        return this.attachmentsService.remove(req.user.userId, id);
    }
}
