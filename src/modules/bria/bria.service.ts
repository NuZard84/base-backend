import { Injectable, Logger, HttpException, HttpStatus, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BriaApiService } from './bria-api.service';
import { BriaPollerService, BriaTaskFailedError, BriaTaskTimeoutError } from './bria-poller.service';
import { S3Service } from '../attachments/s3.service';
import type { RemoveBackgroundResult } from './bria.types';

/**
 * Orchestration layer — submits jobs to BriaApiService, polls via BriaPollerService,
 * and maps errors to HTTP responses.
 *
 * Base64 data URLs from the frontend are uploaded to S3 first so Bria can access them
 * via a presigned URL (Bria requires a publicly accessible HTTP URL).
 *
 * Adding a new tool: call briaApi.<method>() → poll() → return result.
 */
@Injectable()
export class BriaService implements OnModuleInit {
  private readonly logger = new Logger(BriaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly briaApi: BriaApiService,
    private readonly poller: BriaPollerService,
    private readonly s3: S3Service,
  ) {}

  onModuleInit() {
    if (!this.config.get<string>('BRIA_API_KEY')) {
      this.logger.warn('BRIA_API_KEY is not set — Bria endpoints will return 503');
    }
  }

  async removeBackground(image: string): Promise<RemoveBackgroundResult> {
    this.assertApiKeyConfigured();

    // Bria requires a publicly accessible URL — upload base64 data URLs to S3 first
    const { url, tempKey } = await this.resolveImageUrl(image);

    try {
      const { request_id, status_url } = await this.briaApi.removeBackground(url);
      this.logger.log(`[remove_bg] request_id=${request_id} polling...`);

      const image_url = await this.poll(request_id, status_url);
      this.logger.log(`[remove_bg] request_id=${request_id} done → ${image_url}`);

      return { request_id, image_url };
    } finally {
      if (tempKey) {
        this.s3.delete(tempKey).catch(err =>
          this.logger.warn(`[remove_bg] failed to clean up temp S3 key ${tempKey}: ${err}`),
        );
      }
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Returns a URL Bria can access. If the input is a base64 data URL,
   * uploads to S3 and returns a presigned GET URL (1 hour TTL).
   */
  private async resolveImageUrl(image: string): Promise<{ url: string; tempKey: string | null }> {
    if (!image.startsWith('data:')) {
      return { url: image, tempKey: null };
    }

    const match = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/s);
    if (!match) {
      throw new HttpException('Invalid image data URL format', HttpStatus.BAD_REQUEST);
    }

    const [, mimeType, base64Data] = match;
    const ext = mimeType.split('/')[1]?.split('+')[0] ?? 'jpg';
    const key = `bria-tmp/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const buffer = Buffer.from(base64Data, 'base64');

    await this.s3.upload({ key, body: buffer, contentType: mimeType });
    const url = await this.s3.getPresignedUrl({ key, expiresIn: 3600, disposition: 'inline' });

    this.logger.debug(`[resolve_image] uploaded temp S3 key=${key}`);
    return { url, tempKey: key };
  }

  private async poll(requestId: string, statusUrl: string): Promise<string> {
    try {
      return await this.poller.pollUntilComplete(requestId, statusUrl);
    } catch (err) {
      if (err instanceof BriaTaskTimeoutError) {
        throw new HttpException({ message: err.message, code: 'TIMEOUT' }, HttpStatus.GATEWAY_TIMEOUT);
      }
      if (err instanceof BriaTaskFailedError) {
        throw new HttpException({ message: err.message, code: 'PROCESSING_FAILED' }, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      throw err;
    }
  }

  private assertApiKeyConfigured(): void {
    if (!this.config.get<string>('BRIA_API_KEY')) {
      throw new HttpException('Bria API is not configured on this server', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
