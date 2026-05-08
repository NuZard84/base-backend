import { Injectable, Logger } from '@nestjs/common';
import { KlingAuthService } from './kling-auth.service';
import type { KlingTask, KlingApiResponse, TaskStatusResult } from './types/kling.types';

const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const INITIAL_INTERVAL_MS = 5_000;
const MAX_INTERVAL_MS = 15_000;
const BACKOFF_AFTER_MS = 60_000;

export class KlingTaskTimeoutError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
    this.name = 'KlingTaskTimeoutError';
  }
}

export class KlingTaskFailedError extends Error {
  constructor(taskId: string, message: string) {
    super(`Task ${taskId} failed: ${message}`);
    this.name = 'KlingTaskFailedError';
  }
}

@Injectable()
export class KlingPollerService {
  private readonly logger = new Logger(KlingPollerService.name);

  constructor(private readonly auth: KlingAuthService) {}

  async pollUntilComplete(
    taskId: string,
    pollUrl: string,
  ): Promise<TaskStatusResult> {
    const startTime = Date.now();
    let elapsed = 0;

    while (elapsed < POLL_TIMEOUT_MS) {
      await this.sleep(this.getInterval(elapsed));

      elapsed = Date.now() - startTime;
      if (elapsed >= POLL_TIMEOUT_MS) break;

      const result = await this.fetchTaskStatus(taskId, pollUrl);

      if (result.status === 'succeed') return result;
      if (result.status === 'failed') {
        throw new KlingTaskFailedError(taskId, result.error ?? 'Unknown error');
      }

      this.logger.debug(`Task ${taskId} status=${result.status} elapsed=${Math.round(elapsed / 1000)}s`);
    }

    throw new KlingTaskTimeoutError(taskId);
  }

  async fetchTaskStatus(taskId: string, pollUrl: string): Promise<TaskStatusResult> {
    const token = this.auth.generateToken();

    const res = await fetch(pollUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 401) {
      throw new Error('Kling API authentication failed — check KLING_ACCESS_KEY and KLING_SECRET_KEY');
    }

    if (res.status === 429) {
      // Back off and let the poll loop retry rather than blowing up the whole job
      const retryAfter = Number(res.headers.get('retry-after') ?? '30');
      this.logger.warn(`Kling poll 429 — backing off ${retryAfter}s before retry`);
      await this.sleep(retryAfter * 1000);
      return this.fetchTaskStatus(taskId, pollUrl);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Kling API error ${res.status}: ${body}`);
    }

    const json = (await res.json()) as KlingApiResponse<KlingTask>;

    if (json.code !== 0) {
      throw new Error(`Kling API returned error code ${json.code}: ${json.message}`);
    }

    const task = json.data;
    return this.mapTaskStatus(task);
  }

  mapTaskStatus(task: KlingTask): TaskStatusResult {
    const base: TaskStatusResult = {
      task_id: task.task_id,
      status: task.task_status,
      progress: this.inferProgress(task.task_status),
    };

    if (task.task_status === 'succeed') {
      base.video_url = task.task_result?.videos?.[0]?.url;
    }

    if (task.task_status === 'failed') {
      base.error = task.task_status_msg ?? 'Generation failed';
    }

    return base;
  }

  private getInterval(elapsedMs: number): number {
    return elapsedMs < BACKOFF_AFTER_MS ? INITIAL_INTERVAL_MS : MAX_INTERVAL_MS;
  }

  private inferProgress(status: KlingTask['task_status']): number {
    switch (status) {
      case 'submitted': return 5;
      case 'processing': return 50;
      case 'succeed': return 100;
      case 'failed': return 0;
      default: return 0;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
