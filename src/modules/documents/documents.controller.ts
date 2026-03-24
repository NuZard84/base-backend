import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { DocumentsService } from './documents.service';
import { CreatePresignedUrlDto } from './dto/create-presigned-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { DocumentStatus } from '@prisma/client';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('presigned-url')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Request a presigned S3 upload URL',
    description:
      'Step 1 of the upload flow. Returns a time-limited PUT URL for direct browser→S3 upload. ' +
      'Call POST /documents/confirm after the upload completes.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns documentId, uploadUrl, s3Key, expiresInSeconds.',
  })
  createPresignedUrl(@Req() req, @Body() dto: CreatePresignedUrlDto) {
    return this.documentsService.createPresignedUrl(req.user.userId, dto);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Confirm upload and start processing',
    description:
      'Step 2 of the upload flow. Verifies the file landed in S3, marks it PROCESSING, ' +
      'and enqueues the background processing job.',
  })
  @ApiResponse({ status: 200, description: 'Processing queued.' })
  @ApiResponse({ status: 400, description: 'File not found in S3 or already confirmed.' })
  confirm(@Req() req, @Body() dto: ConfirmUploadDto) {
    return this.documentsService.confirmUpload(req.user.userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the current user's documents" })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: DocumentStatus,
    description: 'Filter by processing status',
  })
  @ApiResponse({ status: 200, description: 'Array of document records.' })
  findAll(@Req() req, @Query('status') status?: DocumentStatus) {
    return this.documentsService.findAll(req.user.userId, status);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get document details including chunks and embedding status' })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({ status: 200, description: 'Document with chunks.' })
  @ApiResponse({ status: 404, description: 'Document not found.' })
  findOne(@Req() req, @Param('id') id: string) {
    return this.documentsService.findOne(req.user.userId, id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete document, all its chunks, and the S3 file' })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({ status: 200, description: 'Deleted.' })
  @ApiResponse({ status: 404, description: 'Document not found.' })
  remove(@Req() req, @Param('id') id: string) {
    return this.documentsService.remove(req.user.userId, id);
  }
}
