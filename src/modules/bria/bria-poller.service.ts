import { Injectable, Logger } from '@nestjs/common';
import { BriaApiService } from './bria-api.service';

const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const INITIAL_INTERVAL_MS = 3_000;
const MAX_INTERVAL_MS = 10_000;
const BACKOFF_AFTER_MS = 60_000;

export class BriaTaskTimeoutError extends Error {
  constructor(requestId: string) {
    super(`Bria request ${requestId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
    this.name = 'BriaTaskTimeoutError';
  }
}

export class BriaTaskFailedError extends Error {
  constructor(requestId: string, message: string) {
    super(`Bria request ${requestId} failed: ${message}`);
    this.name = 'BriaTaskFailedError';
  }
}

@Injectable()
export class BriaPollerService {
  private readonly logger = new Logger(BriaPollerService.name);

  constructor(private readonly api: BriaApiService) {}

  async pollUntilComplete(requestId: string, statusUrl: string): Promise<string> {
    const startTime = Date.now();
    let elapsed = 0;

    while (elapsed < POLL_TIMEOUT_MS) {
      await this.sleep(this.getInterval(elapsed));

      elapsed = Date.now() - startTime;
      if (elapsed >= POLL_TIMEOUT_MS) break;

      const result = await this.api.fetchStatus(requestId, statusUrl);

      if (result.status === 'COMPLETED') {
        if (!result.result?.image_url) {
          throw new BriaTaskFailedError(requestId, 'COMPLETED but no image_url in result');
        }
        return result.result.image_url;
      }

      if (result.status === 'FAILED') {
        throw new BriaTaskFailedError(requestId, result.error ?? 'Unknown error');
      }

      this.logger.debug(`Bria ${requestId} status=IN_PROGRESS elapsed=${Math.round(elapsed / 1000)}s`);
    }

    throw new BriaTaskTimeoutError(requestId);
  }

  private getInterval(elapsedMs: number): number {
    return elapsedMs < BACKOFF_AFTER_MS ? INITIAL_INTERVAL_MS : MAX_INTERVAL_MS;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
