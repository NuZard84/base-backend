export interface KlingModelPricing {
  /** Cost in USD per 5-second clip — no audio, standard mode */
  std_no_audio: number;
  /** Cost in USD per 5-second clip — with audio, standard mode */
  std_audio: number;
  /** Cost in USD per 5-second clip — no audio, pro mode */
  pro_no_audio: number;
  /** Cost in USD per 5-second clip — with audio, pro mode */
  pro_audio: number;
}

export interface KlingModelDefinition {
  name: string;
  /** Exact model_name string sent to api.klingai.com */
  apiModelName: string;
  supportsVideoRef: boolean;
  supportsAudioRef: boolean;
  /** Whether this model uses /v1/videos/omni instead of /v1/videos/text2video */
  usesOmniEndpoint: boolean;
  /** Max duration value (numeric, for comparison logic) */
  maxDuration: number;
  modes: ('std' | 'pro' | '4k')[];
  pricing: KlingModelPricing;
}

/**
 * Model IDs used in our API requests.
 * NOTE: apiModelName is what gets sent to Kling — it differs from the key.
 *
 * Model name strings sourced from useapi.net (which proxies api.klingai.com directly).
 * Official docs are behind an auth wall — verify apiModelName on your first live test
 * if you get a 400 "unknown model" error.
 *
 * V3-Omni (O3): research indicates it may route to /v1/videos/omni with omni_version="v3"
 * rather than sharing the text2video endpoint. usesOmniEndpoint flag handles this routing.
 */
export type KlingModelId = 'kling-v3' | 'kling-v3-omni';

export const KLING_MODELS: Record<KlingModelId, KlingModelDefinition> = {
  'kling-v3': {
    name: 'Kling V3 (Video 3.0)',
    apiModelName: 'kling-v3',
    supportsVideoRef: false,
    supportsAudioRef: false,
    usesOmniEndpoint: false,
    maxDuration: 15,
    modes: ['std', 'pro', '4k'],
    pricing: {
      std_no_audio: 0.084,
      std_audio: 0.112,
      pro_no_audio: 0.112,
      pro_audio: 0.14,
    },
  },
  'kling-v3-omni': {
    name: 'Kling V3-Omni (Video 3.0 with Audio)',
    apiModelName: 'kling-v3-omni',
    supportsVideoRef: true,
    supportsAudioRef: true,
    usesOmniEndpoint: true,
    maxDuration: 15,
    modes: ['std', 'pro'],
    pricing: {
      std_no_audio: 0.084,
      std_audio: 0.112,
      pro_no_audio: 0.112,
      pro_audio: 0.14,
    },
  },
};

export const VALID_MODEL_IDS = Object.keys(KLING_MODELS) as KlingModelId[];
// Kling API expects duration as a string — not a number
export const VALID_DURATIONS = ['5', '10', '15'] as const;
export const VALID_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export const VALID_MODES = ['std', 'pro', '4k'] as const;

export type KlingDuration = (typeof VALID_DURATIONS)[number];
export type KlingAspectRatio = (typeof VALID_ASPECT_RATIOS)[number];
export type KlingMode = (typeof VALID_MODES)[number];
