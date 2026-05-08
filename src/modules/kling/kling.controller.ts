import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { KlingService } from './kling.service';
import { TextToVideoDto } from './dto/text-to-video.dto';
import { ImageToVideoDto } from './dto/image-to-video.dto';
import { CostEstimateQueryDto } from './dto/cost-estimate.dto';

@ApiTags('Kling Video Generation')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('video')
export class KlingController {
  private readonly logger = new Logger(KlingController.name);

  constructor(private readonly kling: KlingService) {}

  // ─── Text-to-video ──────────────────────────────────────────────────────────

  @Post('text-to-video')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit a text-to-video generation task (async)' })
  @ApiResponse({ status: 202, description: 'Task accepted — poll /video/task/:task_id for status' })
  async textToVideo(@Body() dto: TextToVideoDto) {
    return this.kling.createTextToVideoTask(dto);
  }

  // ─── Image-to-video ─────────────────────────────────────────────────────────

  @Post('image-to-video')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit an image-to-video generation task (async)' })
  @ApiResponse({ status: 202, description: 'Task accepted — poll /video/task/:task_id for status' })
  async imageToVideo(@Body() dto: ImageToVideoDto) {
    return this.kling.createImageToVideoTask(dto);
  }

  // ─── Task status ────────────────────────────────────────────────────────────

  @Get('task/:task_id')
  @ApiOperation({ summary: 'Poll the status of a generation task' })
  @ApiParam({ name: 'task_id', description: 'Task ID returned by the creation endpoints' })
  @ApiResponse({ status: 200, description: 'Task status — check status field: submitted | processing | succeed | failed' })
  async getTaskStatus(@Param('task_id') taskId: string) {
    return this.kling.getAnyTaskStatus(taskId);
  }

  // ─── Generate-and-wait ──────────────────────────────────────────────────────

  @Post('generate-and-wait')
  @ApiOperation({
    summary: 'Generate video and wait synchronously (polls until complete, max 5 minutes)',
    description: 'Blocks until the video is ready and returns the final URL. Times out after 5 minutes.',
  })
  @ApiResponse({ status: 200, description: 'Video generated successfully — video_url is ready to use' })
  @ApiResponse({ status: 504, description: 'Timed out after 5 minutes' })
  @ApiResponse({ status: 422, description: 'Generation failed or content moderation rejection' })
  async generateAndWait(@Body() dto: TextToVideoDto) {
    return this.kling.generateAndWait(dto);
  }

  // ─── S3 persistence ────────────────────────────────────────────────────────

  @Post('save-to-s3')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download a Kling video URL and save it permanently to S3' })
  async saveToS3(@Body() body: { url: string; taskId: string }, @Req() req: { user: { userId: string } }) {
    return this.kling.saveVideoToS3(body.url, body.taskId, req.user.userId);
  }

  @Post('refresh-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a fresh presigned GET URL for a stored S3 video' })
  async refreshUrl(@Body() body: { s3Key: string }, @Req() req: { user: { userId: string } }) {
    return this.kling.refreshVideoUrl(body.s3Key, req.user.userId);
  }

  // ─── Models & cost ──────────────────────────────────────────────────────────

  @Get('models')
  @ApiOperation({ summary: 'List all supported Kling models with capabilities and pricing' })
  getModels() {
    return this.kling.getModels();
  }

  @Get('cost-estimate')
  @ApiOperation({ summary: 'Estimate generation cost in USD' })
  @ApiQuery({ name: 'model', description: 'Model ID', enum: ['kling-v3', 'kling-v3-omni'] })
  @ApiQuery({ name: 'mode', description: 'Mode', enum: ['std', 'pro'] })
  @ApiQuery({ name: 'duration', description: 'Duration in seconds', enum: [5, 10, 15] })
  @ApiQuery({ name: 'audio', description: 'Enable audio', type: Boolean })
  costEstimate(@Query() query: CostEstimateQueryDto) {
    return this.kling.estimateCost(query.model, query.mode, query.duration, query.audio);
  }
}
