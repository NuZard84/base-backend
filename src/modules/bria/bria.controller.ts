import {
  Controller,
  Post,
  Body,
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
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PlanService, RESOURCE_TYPES } from 'src/common/plans';
import { CreditService } from 'src/common/credits/credit.service';
import { BriaService } from './bria.service';
import { RemoveBackgroundDto } from './dto/remove-background.dto';

@ApiTags('Bria Image Editing')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('bria')
export class BriaController {
  private readonly logger = new Logger(BriaController.name);

  constructor(
    private readonly bria: BriaService,
    private readonly planService: PlanService,
    private readonly creditService: CreditService,
  ) {}

  @Post('remove-background')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove background from an image (RMBG-2.0)',
    description:
      'Submits the image to Bria RMBG-2.0, polls until complete, and returns the transparent PNG URL. ' +
      'Accepts a publicly accessible image URL (JPEG, PNG, WEBP).',
  })
  @ApiBody({ type: RemoveBackgroundDto })
  @ApiResponse({
    status: 200,
    description: 'Background removed — image_url points to the resulting transparent PNG',
    schema: {
      example: {
        request_id: 'uuid',
        image_url: 'https://cdn.bria.ai/results/...png',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Bria API key not valid' })
  @ApiResponse({ status: 415, description: 'Unsupported image format' })
  @ApiResponse({ status: 422, description: 'Content moderation or validation failure' })
  @ApiResponse({ status: 429, description: 'Bria API rate limit exceeded' })
  @ApiResponse({ status: 503, description: 'Bria API not configured on this server' })
  @ApiResponse({ status: 504, description: 'Processing timed out' })
  async removeBackground(
    @Body() dto: RemoveBackgroundDto,
    @Req() req: { user: { userId: string } },
  ) {
    const { userId } = req.user;
    this.logger.log(`[remove_bg] image=${dto.image.slice(0, 80)}...`);
    await this.creditService.grantMonthlyCredits(userId);
    const cost = await this.creditService.getCost('remove_bg');
    await this.creditService.check(userId, cost);
    const result = await this.bria.removeBackground(dto.image);
    await this.planService.logUsage(userId, RESOURCE_TYPES.REMOVE_BG, 1);
    await this.creditService.deduct(userId, cost, 'remove_bg', RESOURCE_TYPES.REMOVE_BG);
    return result;
  }
}
