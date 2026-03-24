import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { SummarizeService } from './summarize.service';
import { SummarizeAttachmentDto } from './dto/summarize-attachment.dto';

@ApiTags('Documents / Summarize')
@ApiBearerAuth()
@Controller('documents')
export class SummarizeController {
  constructor(private readonly summarizeService: SummarizeService) {}

  @Post('attachments/:id/summarize')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Summarize an uploaded attachment using AI',
    description:
      'Downloads the file from S3, parses its content (PDF, CSV, or image), and sends it to the selected AI provider for summarization. Defaults to Gemini.',
  })
  @ApiParam({ name: 'id', description: 'Attachment ID' })
  @ApiBody({ type: SummarizeAttachmentDto, required: false })
  @ApiResponse({ status: 200, description: 'Summary generated successfully.' })
  @ApiResponse({ status: 400, description: 'Unsupported file type or bad request.' })
  @ApiResponse({ status: 404, description: 'Attachment not found.' })
  summarize(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: SummarizeAttachmentDto = {},
  ) {
    return this.summarizeService.summarizeAttachment(req.user.userId, id, dto);
  }

  @Get('providers')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List available AI providers and their configuration status',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns array of { name, isConfigured } for each provider.',
  })
  listProviders() {
    return this.summarizeService.listProviders();
  }
}
