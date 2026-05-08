import type { KlingAspectRatio, KlingDuration, KlingMode, KlingModelId } from '../constants/kling-models';

// ─── Kling API Request Shapes ────────────────────────────────────────────────

export interface KlingText2VideoRequest {
  model_name: string;
  prompt: string;
  negative_prompt?: string;
  cfg_scale?: number;
  mode: KlingMode;
  aspect_ratio: KlingAspectRatio;
  duration: KlingDuration;
  /** "on" | "off" — per official Kling API docs */
  sound?: 'on' | 'off';
  callback_url?: string;
}

export interface KlingImage2VideoRequest {
  model_name: string;
  prompt: string;
  negative_prompt?: string;
  cfg_scale?: number;
  mode: KlingMode;
  aspect_ratio: KlingAspectRatio;
  duration: KlingDuration;
  sound?: 'on' | 'off';
  image: string;
  image_tail?: string;
  callback_url?: string;
}

export interface KlingOmniImageEntry {
  image_url: string;
  /** "first_frame" | "end_frame" — omit if not a start/end frame */
  type?: 'first_frame' | 'end_frame';
}

/** Request shape for POST /v1/videos/omni-video */
export interface KlingOmniRequest {
  model_name: string;
  prompt: string;
  negative_prompt?: string;
  mode: KlingMode;
  aspect_ratio?: KlingAspectRatio;
  duration: KlingDuration;
  sound?: 'on' | 'off';
  image_list?: KlingOmniImageEntry[];
  callback_url?: string;
}

// ─── Kling API Response Shapes ───────────────────────────────────────────────

export type KlingTaskStatus = 'submitted' | 'processing' | 'succeed' | 'failed';

export interface KlingVideo {
  id: string;
  url: string;
  duration: string;
}

export interface KlingTaskResult {
  videos: KlingVideo[];
}

export interface KlingTask {
  task_id: string;
  task_status: KlingTaskStatus;
  task_status_msg?: string;
  task_result?: KlingTaskResult;
  created_at: number;
  updated_at: number;
}

export interface KlingApiResponse<T> {
  code: number;
  message: string;
  request_id: string;
  data: T;
}

export interface KlingCreateTaskResponse {
  task_id: string;
  task_status: KlingTaskStatus;
  created_at: number;
  updated_at: number;
}

// ─── Service-level types ─────────────────────────────────────────────────────

export interface CreateTaskResult {
  task_id: string;
  status: KlingTaskStatus;
}

export interface TaskStatusResult {
  task_id: string;
  status: KlingTaskStatus;
  video_url?: string;
  progress?: number;
  error?: string;
}

export interface GenerateAndWaitResult {
  task_id: string;
  status: 'succeed';
  video_url: string;
  duration_ms: number;
}

export interface CostEstimate {
  model: KlingModelId;
  mode: KlingMode;
  duration: KlingDuration;
  audio: boolean;
  cost_usd: number;
  breakdown: string;
}
