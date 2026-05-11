import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { AiPythonClient } from './ai-python.client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vision = require('@google-cloud/vision');

const ALLOWED_MIMETYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_POINTS = 10;

export interface DetectedTextRegion {
  text: string;
  index: number;
}

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

  async detectText(imageUrl: string): Promise<DetectedTextRegion[]> {
    const credsRaw = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;
    if (!credsRaw) throw new InternalServerErrorException('Google Cloud Vision credentials not configured');

    const credentials = JSON.parse(credsRaw);
    const client = new vision.ImageAnnotatorClient({ credentials });

    this.logger.log(`[detect-text] ${imageUrl.slice(0, 80)}…`);

    const [result] = await client.textDetection({ image: { source: { imageUri: imageUrl } } });
    const annotations: any[] = result.textAnnotations ?? [];
    if (!annotations.length) return [];

    const fullText: string = annotations[0].description ?? '';
    const lines = fullText.split('\n').filter((l: string) => l.trim().length > 0);

    return lines.map((text: string, index: number) => ({ text, index }));
  }

  private validate(file: Express.Multer.File, points: [number, number][]): void {
    if (!file) throw new BadRequestException('Image file is required');
    if (!ALLOWED_MIMETYPES.has(file.mimetype))
      throw new BadRequestException(`Unsupported type "${file.mimetype}". Allowed: JPEG, PNG, WEBP`);
    if (!points?.length) throw new BadRequestException('At least one point is required');
    if (points.length > MAX_POINTS) throw new BadRequestException(`Maximum ${MAX_POINTS} points allowed`);
  }
}
