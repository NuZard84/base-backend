import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BriaAsyncResponse, BriaStatusResponse } from './bria.types';

const BRIA_BASE_URL = 'https://engine.prod.bria-api.com';

/**
 * Low-level Bria HTTP client.
 *
 * One method per Bria endpoint — each method submits a job and returns
 * { request_id, status_url } without waiting for completion.
 * BriaService calls these and delegates polling to BriaPollerService.
 *
 * Adding a new Bria tool: add one method here, wire it in BriaService.
 */
@Injectable()
export class BriaApiService {
  private readonly logger = new Logger(BriaApiService.name);
  readonly baseUrl = BRIA_BASE_URL;

  private readonly apiKey: string;
  private readonly userAgent: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('BRIA_API_KEY') ?? '';
    this.userAgent = `BriaSkills/${this.config.get<string>('npm_package_version') ?? '1.0.0'}`;
  }

  // ─── Tool endpoints ──────────────────────────────────────────────────────────

  async removeBackground(imageUrl: string): Promise<BriaAsyncResponse> {
    return this.post('/v2/image/edit/remove_background', { image: imageUrl });
  }

  // ─── Status polling ──────────────────────────────────────────────────────────

  async fetchStatus(requestId: string, statusUrl: string): Promise<BriaStatusResponse> {
    const res = await fetch(statusUrl, { headers: this.buildHeaders() });

    if (res.status === 401) {
      throw new Error('Bria API authentication failed — verify BRIA_API_KEY');
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '30');
      this.logger.warn(`Bria poll 429 for ${requestId} — backing off ${retryAfter}s`);
      await this.sleep(retryAfter * 1000);
      return this.fetchStatus(requestId, statusUrl);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bria status API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<BriaStatusResponse>;
  }

  // ─── Shared HTTP helpers ─────────────────────────────────────────────────────

  buildHeaders(): Record<string, string> {
    return {
      api_token: this.apiKey,
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
    };
  }

  private async post(path: string, body: Record<string, unknown>): Promise<BriaAsyncResponse> {
    const url = `${BRIA_BASE_URL}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      throw new HttpException(
        'Bria API authentication failed — verify BRIA_API_KEY',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (res.status === 415) {
      throw new HttpException(
        'Unsupported image format — use JPEG, PNG, or WEBP',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    if (res.status === 422) {
      const json = await res.json().catch(() => ({})) as { detail?: string };
      throw new HttpException(
        `Content moderation or validation failed: ${json.detail ?? 'unspecified'}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') ?? '60';
      throw new HttpException(
        { message: 'Bria API rate limit exceeded', retry_after_seconds: Number(retryAfter) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (res.status >= 500) {
      const text = await res.text();
      this.logger.error(`Bria server error ${res.status} at ${path}: ${text}`);
      throw new HttpException('Bria API server error — please retry', HttpStatus.BAD_GATEWAY);
    }

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Bria API unexpected error ${res.status} at ${path}: ${text}`);
      throw new HttpException(`Bria API error: ${text}`, res.status);
    }

    const json = await res.json() as BriaAsyncResponse;

    if (!json.request_id || !json.status_url) {
      throw new HttpException(
        'Bria API returned an unexpected response shape',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return json;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
