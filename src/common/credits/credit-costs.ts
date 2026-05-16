// ─── Credit Cost Defaults ─────────────────────────────────────────────────────
// Source of truth for credit costs per action.
// These values are loaded at runtime from AppConfig (key: `credit_cost:<key>`)
// so they can be changed from the admin panel without a deploy.
// This file is the fallback when no DB override exists.
//
// Frontend mirror: base/src/lib/credit-costs.ts — keep in sync.

export const DEFAULT_CREDIT_COSTS: Record<string, number> = {
  // AI chat — charged per 1 000 tokens (rounded up)
  'ai_request_per_1k_tokens': 1,

  // Image generation (per image)
  'image_gen': 5,

  // Video generation — keyed as video_gen:<mode>:<duration_seconds>
  'video_gen:std:5':  10,
  'video_gen:std:10': 18,
  'video_gen:std:15': 25,
  'video_gen:pro:5':  15,
  'video_gen:pro:10': 28,
  'video_gen:pro:15': 40,
  'video_gen:4k:5':   30,
  'video_gen:4k:10':  55,
  'video_gen:4k:15':  75,

  // Image tools
  'remove_bg':   3,
  'text_editor': 2,
  'upscale':     4, // for when upscale is built

  // Documents & infographics
  'document_upload': 2,
  'vizora_gen':      8,
} as const;

export type CreditCostKey = keyof typeof DEFAULT_CREDIT_COSTS;

// Prefix used in AppConfig table for all credit cost overrides
export const CREDIT_COST_PREFIX = 'credit_cost:';

// AppConfig key that globally enables/disables credit deduction.
// Keep as "false" (string) until users have been granted their first monthly credits.
export const CREDITS_ENABLED_KEY = 'credits_enabled';
