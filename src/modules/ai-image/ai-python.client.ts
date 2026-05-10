/**
 * HTTP client for the Python FastAPI AI microservice.
 * Uses native Node 18+ fetch — no axios dependency.
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_PIPELINE_URL = 'http://localhost:8000';

@Injectable()
export class AiPythonClient {
  private readonly logger = new Logger(AiPythonClient.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('PIPELINE_BASE_URL') ?? DEFAULT_PIPELINE_URL;
    this.logger.log(`AI pipeline URL: ${this.baseUrl}`);
  }

  /** Colored mask overlay PNG — SAM2 preview with distinct colors per object. */
  async segment(imageBuffer: Buffer, mimetype: string, points: [number, number][]): Promise<Buffer> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(imageBuffer)], { type: mimetype }), 'image.png');
    form.append('points', JSON.stringify(points));
    return this.postImage('/segment', form, 60_000);
  }

  /** Binary inpainting mask: white = object (erase region), black = background. */
  async binaryMask(imageBuffer: Buffer, mimetype: string, points: [number, number][]): Promise<Buffer> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(imageBuffer)], { type: mimetype }), 'image.png');
    form.append('points', JSON.stringify(points));
    form.append('mode', 'binary');
    return this.postImage('/mask', form, 90_000);
  }

  /** Alpha cutout: RGBA PNG, object pixels opaque, background transparent. */
  async alphaMask(imageBuffer: Buffer, mimetype: string, points: [number, number][]): Promise<Buffer> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(imageBuffer)], { type: mimetype }), 'image.png');
    form.append('points', JSON.stringify(points));
    form.append('mode', 'alpha');
    return this.postImage('/mask', form, 90_000);
  }

  private async postImage(path: string, form: FormData, timeoutMs: number): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method: 'POST', body: form, signal: controller.signal });
    } catch (err: unknown) {
      clearTimeout(timer);
      return this.handleFetchError(err);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail = text;
      try { detail = (JSON.parse(text) as { detail?: string }).detail ?? text; } catch { /* not JSON */ }
      this.logger.error(`Python AI ${res.status} at ${path}: ${detail}`);
      throw new HttpException(
        `AI service error: ${detail}`.slice(0, 400),
        res.status >= 500 ? HttpStatus.BAD_GATEWAY : res.status,
      );
    }

    return Buffer.from(await res.arrayBuffer());
  }

  private handleFetchError(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isRefused = message.includes('ECONNREFUSED') || message.includes('ENOTFOUND');

    if (isAbort) throw new HttpException('AI service timed out', HttpStatus.GATEWAY_TIMEOUT);
    if (isRefused) throw new HttpException('AI service unavailable — ensure Python service is running on port 8000', HttpStatus.SERVICE_UNAVAILABLE);
    throw new HttpException(`AI service unreachable: ${message}`, HttpStatus.BAD_GATEWAY);
  }
}
