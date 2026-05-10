import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AiImageService } from './ai-image.service';
import { EraseImageDto } from './dto/erase-image.dto';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const FILE_INTERCEPTOR = FileInterceptor('image', {
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
    } else {
      cb(null, true);
    }
  },
});

const PNG_HEADERS = (length: number) => ({
  'Content-Type': 'image/png',
  'Content-Length': length.toString(),
  'Cache-Control': 'no-store',
});

@ApiTags('AI Image Masking')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('ai-image')
export class AiImageController {
  private readonly logger = new Logger(AiImageController.name);

  constructor(private readonly aiImage: AiImageService) {}

  @Post('segment')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FILE_INTERCEPTOR)
  @ApiOperation({ summary: 'SAM2 segmentation preview — colored overlay PNG, one color per clicked object' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object', required: ['image', 'points'],
      properties: {
        image: { type: 'string', format: 'binary' },
        points: { type: 'string', example: '[[120,80],[300,200]]' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Colored mask overlay PNG' })
  async segment(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: EraseImageDto,
    @Res() res: Response,
  ): Promise<void> {
    const points = dto.parsedPoints();
    this.logger.log(`[POST /segment] ${points.length} point(s)`);
    const png = await this.aiImage.segmentPreview(file, points);
    res.set(PNG_HEADERS(png.length));
    res.send(png);
  }

  @Post('mask')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FILE_INTERCEPTOR)
  @ApiOperation({ summary: 'Binary inpainting mask — white=object (erase region), black=background. Standard format.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object', required: ['image', 'points'],
      properties: {
        image: { type: 'string', format: 'binary' },
        points: { type: 'string', example: '[[120,80]]' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Grayscale binary mask PNG (white=erase, black=preserve)' })
  async mask(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: EraseImageDto,
    @Res() res: Response,
  ): Promise<void> {
    const points = dto.parsedPoints();
    this.logger.log(`[POST /mask] ${points.length} point(s)`);
    const png = await this.aiImage.binaryMask(file, points);
    res.set(PNG_HEADERS(png.length));
    res.send(png);
  }

  @Post('alpha-mask')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FILE_INTERCEPTOR)
  @ApiOperation({ summary: 'Alpha cutout — RGBA PNG, object pixels opaque, background transparent' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object', required: ['image', 'points'],
      properties: {
        image: { type: 'string', format: 'binary' },
        points: { type: 'string', example: '[[120,80]]' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'RGBA cutout PNG' })
  async alphaMask(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: EraseImageDto,
    @Res() res: Response,
  ): Promise<void> {
    const points = dto.parsedPoints();
    this.logger.log(`[POST /alpha-mask] ${points.length} point(s)`);
    const png = await this.aiImage.alphaMask(file, points);
    res.set(PNG_HEADERS(png.length));
    res.send(png);
  }
}
