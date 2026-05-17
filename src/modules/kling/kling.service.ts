import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { KlingAuthService } from './kling-auth.service';
import { KlingPollerService, KlingTaskFailedError, KlingTaskTimeoutError } from './kling-poller.service';
import { S3Service } from '../attachments/s3.service';
import { KLING_MODELS, type KlingModelId, type KlingMode, type KlingDuration } from './constants/kling-models';
import type { TextToVideoDto } from './dto/text-to-video.dto';
import type { ImageToVideoDto } from './dto/image-to-video.dto';
import type {
  CreateTaskResult,
  TaskStatusResult,
  GenerateAndWaitResult,
  CostEstimate,
  KlingApiResponse,
  KlingCreateTaskResponse,
  KlingText2VideoRequest,
  KlingImage2VideoRequest,
  KlingOmniRequest,
} from './types/kling.types';

const KLING_BASE_URL = 'https://api-singapore.klingai.com';
const MAX_CONCURRENT = 5;

/** Strip data:image/...;base64, prefix — Kling expects raw base64 */
function stripDataUri(value: string): string {
  const match = value.match(/^data:image\/.+;base64,(.+)$/s);
  return match ? match[1] : value;
}

@Injectable()
export class KlingService {
  private readonly logger = new Logger(KlingService.name);
  private activeGenerations = 0;

  constructor(
    private readonly auth: KlingAuthService,
    private readonly poller: KlingPollerService,
    private readonly s3: S3Service,
  ) {}

  // ─── Task creation ──────────────────────────────────────────────────────────

  async createTextToVideoTask(dto: TextToVideoDto): Promise<CreateTaskResult> {
    this.validateModelCapabilities(dto.model, dto.audio, dto.duration);
    this.checkConcurrencyLimit();

    const modelDef = KLING_MODELS[dto.model];

    if (modelDef.usesOmniEndpoint) {
      const body: KlingOmniRequest = {
        model_name: modelDef.apiModelName,
        prompt: dto.prompt,
        mode: dto.mode,
        aspect_ratio: dto.aspect_ratio,
        duration: dto.duration,
        ...(dto.audio && { sound: 'on' }),
        ...(dto.negative_prompt && { negative_prompt: dto.negative_prompt }),
      };
      this.logger.log(`[T2V/Omni] model=${modelDef.apiModelName} mode=${dto.mode} dur=${dto.duration}s`);
      return this.postCreateTask('/v1/videos/omni-video', body);
    }

    const body: KlingText2VideoRequest = {
      model_name: modelDef.apiModelName,
      prompt: dto.prompt,
      mode: dto.mode,
      aspect_ratio: dto.aspect_ratio,
      duration: dto.duration,
      ...(dto.audio && { sound: 'on' }),
      ...(dto.negative_prompt && { negative_prompt: dto.negative_prompt }),
    };
    this.logger.log(`[T2V] model=${modelDef.apiModelName} mode=${dto.mode} dur=${dto.duration}s`);
    return this.postCreateTask('/v1/videos/text2video', body);
  }

  async createImageToVideoTask(dto: ImageToVideoDto): Promise<CreateTaskResult> {
    this.validateModelCapabilities(dto.model, dto.audio, dto.duration);
    this.checkConcurrencyLimit();

    const modelDef = KLING_MODELS[dto.model];

    if (modelDef.usesOmniEndpoint) {
      const imageList: KlingOmniRequest['image_list'] = [
        { image_url: stripDataUri(dto.image_url), type: 'first_frame' },
      ];
      if (dto.end_image_url) {
        imageList.push({ image_url: stripDataUri(dto.end_image_url), type: 'end_frame' });
      }
      if (dto.style_refs?.length) {
        dto.style_refs.forEach(ref => imageList.push({ image_url: stripDataUri(ref) }));
      }
      const body: KlingOmniRequest = {
        model_name: modelDef.apiModelName,
        prompt: dto.prompt,
        mode: dto.mode,
        duration: dto.duration,
        ...(dto.audio && { sound: 'on' }),
        ...(dto.negative_prompt && { negative_prompt: dto.negative_prompt }),
        image_list: imageList,
      };
      this.logger.log(`[I2V/Omni] model=${modelDef.apiModelName} mode=${dto.mode} dur=${dto.duration}s`);
      return this.postCreateTask('/v1/videos/omni-video', body);
    }

    const body: KlingImage2VideoRequest = {
      model_name: modelDef.apiModelName,
      prompt: dto.prompt,
      mode: dto.mode,
      aspect_ratio: dto.aspect_ratio,
      duration: dto.duration,
      ...(dto.audio && { sound: 'on' }),
      image: stripDataUri(dto.image_url),
      ...(dto.end_image_url && { image_tail: stripDataUri(dto.end_image_url) }),
      ...(dto.negative_prompt && { negative_prompt: dto.negative_prompt }),
    };
    this.logger.log(`[I2V] model=${modelDef.apiModelName} mode=${dto.mode} dur=${dto.duration}s`);
    return this.postCreateTask('/v1/videos/image2video', body);
  }

  // ─── Task status ────────────────────────────────────────────────────────────

  async getTextToVideoStatus(taskId: string): Promise<TaskStatusResult> {
    return this.poller.fetchTaskStatus(taskId, `${KLING_BASE_URL}/v1/videos/text2video/${taskId}`);
  }

  async getImageToVideoStatus(taskId: string): Promise<TaskStatusResult> {
    return this.poller.fetchTaskStatus(taskId, `${KLING_BASE_URL}/v1/videos/image2video/${taskId}`);
  }

  async getOmniVideoStatus(taskId: string): Promise<TaskStatusResult> {
    return this.poller.fetchTaskStatus(taskId, `${KLING_BASE_URL}/v1/videos/omni-video/${taskId}`);
  }

  /** Tries all three endpoints — lets callers poll without tracking which endpoint created the task */
  async getAnyTaskStatus(taskId: string): Promise<TaskStatusResult> {
    const endpoints = [
      `${KLING_BASE_URL}/v1/videos/text2video/${taskId}`,
      `${KLING_BASE_URL}/v1/videos/image2video/${taskId}`,
      `${KLING_BASE_URL}/v1/videos/omni-video/${taskId}`,
    ];
    let lastError: unknown;
    for (const url of endpoints) {
      try {
        return await this.poller.fetchTaskStatus(taskId, url);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  // ─── Generate-and-wait ──────────────────────────────────────────────────────

  async generateAndWait(dto: TextToVideoDto): Promise<GenerateAndWaitResult> {
    const start = Date.now();
    this.checkConcurrencyLimit();
    this.activeGenerations++;
    try {
      const { task_id } = await this.createTextToVideoTask(dto);
      const modelDef = KLING_MODELS[dto.model];
      const pollUrl = modelDef.usesOmniEndpoint
        ? `${KLING_BASE_URL}/v1/videos/omni-video/${task_id}`
        : `${KLING_BASE_URL}/v1/videos/text2video/${task_id}`;

      const result = await this.poller.pollUntilComplete(task_id, pollUrl);
      if (!result.video_url) throw new Error('Task succeeded but no video URL was returned');

      const duration_ms = Date.now() - start;
      this.logger.log(`[G&W] task=${task_id} done in ${(duration_ms / 1000).toFixed(1)}s`);
      return { task_id, status: 'succeed', video_url: result.video_url, duration_ms };
    } catch (err) {
      if (err instanceof KlingTaskTimeoutError) {
        throw new HttpException({ message: err.message, code: 'TIMEOUT' }, HttpStatus.GATEWAY_TIMEOUT);
      }
      if (err instanceof KlingTaskFailedError) {
        throw new HttpException({ message: err.message, code: 'GENERATION_FAILED' }, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      throw err;
    } finally {
      this.activeGenerations--;
    }
  }

  // ─── Models & pricing ───────────────────────────────────────────────────────

  getModels() {
    return KLING_MODELS;
  }

  estimateCost(model: KlingModelId, mode: KlingMode, duration: KlingDuration, audio: boolean): CostEstimate {
    const modelDef = KLING_MODELS[model];
    if (!modelDef) throw new BadRequestException(`Unknown model: ${model}`);
    const cost = this.computeCost(model, mode, duration, audio);
    const segments = Number(duration) / 5;
    const priceKey = `${mode}_${audio ? 'audio' : 'no_audio'}` as keyof typeof modelDef.pricing;
    return {
      model, mode, duration, audio,
      cost_usd: cost,
      breakdown: `${segments} × $${modelDef.pricing[priceKey]}/5s = $${cost.toFixed(4)}`,
    };
  }

  // ─── S3 persistence ────────────────────────────────────────────────────────

  async saveVideoToS3(klingUrl: string, taskId: string, userId: string): Promise<{ url: string; s3Key: string }> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000); // 60s download timeout
    let res: Response;
    try {
      res = await fetch(klingUrl, { signal: abort.signal });
    } catch (err) {
      throw new HttpException(
        abort.signal.aborted ? 'Kling video download timed out' : 'Failed to reach Kling CDN',
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new HttpException('Failed to download video from Kling', HttpStatus.BAD_GATEWAY);

    const buffer = Buffer.from(await res.arrayBuffer());
    const key = `videos/${userId}/${taskId}.mp4`;

    await this.s3.upload({ key, body: buffer, contentType: 'video/mp4' });
    this.logger.log(`[S3] Saved video task=${taskId} key=${key}`);

    const url = await this.s3.getPresignedUrl({ key, expiresIn: 604800, disposition: 'inline' });
    return { url, s3Key: key };
  }

  async refreshVideoUrl(s3Key: string, userId: string): Promise<{ url: string }> {
    // Validate format only: videos/{ownerUserId}/{taskId}.mp4 — no per-user lock-in.
    // Peers in shared canvases need to refresh URLs for videos they didn't create.
    // Access is already gated by canvas-share permissions (if you can see the node,
    // you already have the s3Key), and the s3Key contains a non-guessable taskId.
    if (!/^videos\/[^/]+\/[^/]+\.mp4$/.test(s3Key)) {
      throw new HttpException('Invalid s3Key', HttpStatus.BAD_REQUEST);
    }
    // userId retained in the signature for future audit logging
    void userId;
    const url = await this.s3.getPresignedUrl({ key: s3Key, expiresIn: 604800, disposition: 'inline' });
    return { url };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async postCreateTask(
    path: string,
    body: KlingText2VideoRequest | KlingImage2VideoRequest | KlingOmniRequest,
  ): Promise<CreateTaskResult> {
    const token = this.auth.generateToken();

    const res = await fetch(`${KLING_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      throw new HttpException(
        'Kling API authentication failed — verify KLING_ACCESS_KEY and KLING_SECRET_KEY',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') ?? '60';
      throw new HttpException(
        { message: 'Kling API quota exceeded', retry_after_seconds: Number(retryAfter) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Kling API error ${res.status}: ${text}`);
      throw new HttpException(`Kling API error: ${text}`, res.status);
    }

    const json = (await res.json()) as KlingApiResponse<KlingCreateTaskResponse>;

    if (json.code !== 0) {
      if (json.message?.toLowerCase().includes('content') || json.message?.toLowerCase().includes('moderat')) {
        throw new HttpException(
          { message: 'Content moderation rejection: ' + json.message, code: 'CONTENT_MODERATION' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw new HttpException(`Kling error ${json.code}: ${json.message}`, HttpStatus.BAD_GATEWAY);
    }

    return { task_id: json.data.task_id, status: json.data.task_status };
  }

  private validateModelCapabilities(model: KlingModelId, audio: boolean, duration: KlingDuration): void {
    const modelDef = KLING_MODELS[model];
    if (!modelDef) {
      throw new BadRequestException(`Invalid model "${model}". Valid: ${Object.keys(KLING_MODELS).join(', ')}`);
    }
    if (Number(duration) > modelDef.maxDuration) {
      throw new BadRequestException(
        `Model ${model} supports max duration of ${modelDef.maxDuration}s, requested ${duration}s`,
      );
    }
    if (audio && !modelDef.supportsAudioRef) {
      throw new BadRequestException(`Model ${model} does not support audio. Use kling-v3-omni for audio.`);
    }
  }

  private checkConcurrencyLimit(): void {
    if (this.activeGenerations >= MAX_CONCURRENT) {
      throw new ServiceUnavailableException(
        `Server at capacity (${MAX_CONCURRENT} concurrent generations). Please retry shortly.`,
      );
    }
  }

  private computeCost(model: KlingModelId, mode: KlingMode, duration: KlingDuration, audio: boolean): number {
    const modelDef = KLING_MODELS[model];
    const priceKey = `${mode}_${audio ? 'audio' : 'no_audio'}` as keyof typeof modelDef.pricing;
    return Math.round(modelDef.pricing[priceKey] * (Number(duration) / 5) * 10000) / 10000;
  }
}
