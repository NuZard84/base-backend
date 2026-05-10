import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AiPythonClient } from './ai-python.client';

const ALLOWED_MIMETYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_POINTS = 10;

@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);

  constructor(private readonly python: AiPythonClient) {}

  /** SAM2 colored overlay preview — one color per object. */
  async segmentPreview(file: Express.Multer.File, points: [number, number][]): Promise<Buffer> {
    this.validate(file, points);
    this.logger.log(`[segment] "${file.originalname}" ${points.length} point(s)`);
    return this.python.segment(file.buffer, file.mimetype, points);
  }

  /** Binary inpainting mask — white=object (erase), black=background (preserve). */
  async binaryMask(file: Express.Multer.File, points: [number, number][]): Promise<Buffer> {
    this.validate(file, points);
    this.logger.log(`[binary-mask] "${file.originalname}" ${points.length} point(s)`);
    return this.python.binaryMask(file.buffer, file.mimetype, points);
  }

  /** Alpha cutout — RGBA PNG, object opaque, background transparent. */
  async alphaMask(file: Express.Multer.File, points: [number, number][]): Promise<Buffer> {
    this.validate(file, points);
    this.logger.log(`[alpha-mask] "${file.originalname}" ${points.length} point(s)`);
    return this.python.alphaMask(file.buffer, file.mimetype, points);
  }

  private validate(file: Express.Multer.File, points: [number, number][]): void {
    if (!file) throw new BadRequestException('Image file is required');
    if (!ALLOWED_MIMETYPES.has(file.mimetype))
      throw new BadRequestException(`Unsupported type "${file.mimetype}". Allowed: JPEG, PNG, WEBP`);
    if (!points?.length) throw new BadRequestException('At least one point is required');
    if (points.length > MAX_POINTS) throw new BadRequestException(`Maximum ${MAX_POINTS} points allowed`);
  }
}
