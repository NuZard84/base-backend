// ─── Plan Configuration (Source of Truth) ───────────────────────────────────
// This file defines all plan tiers, their limits, and feature flags.
// The frontend maintains a static mirror of this config for instant UI checks.
// Any changes here must be reflected in: base/src/lib/plan-config.ts

export interface PlanLimits {
  maxProjects: number; // -1 = unlimited
  maxStorageMb: number;
  maxNodesPerCanvas: number;
  maxCollaboratorsPerCanvas: number; // -1 = unlimited
  maxCreditsPerMonth: number; // monthly credit grant — overridable from admin panel
}

export interface PlanFeatures {
  collaboration: boolean;
  customFlowExports: boolean;
  customAiPrompts: boolean;
  ragDocumentUpload: boolean;
  advancedAiModels: boolean;
  imageGeneration: boolean;
  videoGeneration: boolean; // requires paid plan (PLUS/PRO)
  prioritySupport: boolean;
  importChat: boolean;
  vizoraInfographic: boolean;
}

export interface PlanDefinition {
  tier: string;
  displayName: string;
  description: string;
  price: number; // in cents (0 = free)
  currency: string;
  billingPeriod: 'monthly';
  visible: boolean; // whether to show in pricing UI
  limits: PlanLimits;
  features: PlanFeatures;
}

// Models available on the FREE tier (Gemini 2.x, 2.5.x, and 3.x)
// Any model NOT in this set requires the advancedAiModels feature flag.
export const FREE_TIER_AI_MODELS = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
]);

// Resource types used in UsageLog for tracking
export const RESOURCE_TYPES = {
  AI_REQUEST: 'ai_request',
  IMAGE_GEN: 'image_gen',
  FILE_UPLOAD: 'file_upload',
  DOCUMENT_UPLOAD: 'document_upload',
  VIZORA_GEN: 'vizora_gen',
  VIDEO_GEN: 'video_gen',
  REMOVE_BG: 'remove_bg',
  TEXT_EDITOR: 'text_editor',
} as const;

// Limit type identifiers used by @CheckLimit decorator.
// Generation counts (ai_requests, image_gen, vizora_gen) are intentionally NOT
// listed — those are gated by the credit system, not monthly quotas.
export type LimitType =
  | 'projects'
  | 'storage'
  | 'nodes_per_canvas'
  | 'collaborators'
  | 'credits';

// Feature keys used by @RequireFeature decorator
export type FeatureKey = keyof PlanFeatures;

export const PLAN_CONFIG: Record<string, PlanDefinition> = {
  FREE: {
    tier: 'FREE',
    displayName: 'Free',
    description: 'Basic access, always free',
    price: 0,
    currency: 'usd',
    billingPeriod: 'monthly',
    visible: true,
    limits: {
      maxProjects: 3,
      maxStorageMb: 12,
      maxNodesPerCanvas: 250,  // cap prevents a free user from OOM-ing the Cloud Run instance
      maxCollaboratorsPerCanvas: 2,
      maxCreditsPerMonth: 50,
    },
    features: {
      collaboration: true,
      customFlowExports: false,
      customAiPrompts: false,
      ragDocumentUpload: false,

      advancedAiModels: false,
      imageGeneration: true,
      videoGeneration: false,
      prioritySupport: false,
      importChat: false,
      vizoraInfographic: false,
    },
  },

  STARTER: {
    tier: 'STARTER',
    displayName: 'Free Starter',
    description: 'Your free trial — more usage to get started',
    price: 0, // free trial, no charge
    currency: 'usd',
    billingPeriod: 'monthly',
    visible: true, // shown in pricing UI as the trial plan
    limits: {
      maxProjects: 3,                 // SAME as FREE — no conflict when trial ends
      maxStorageMb: 12,               // SAME as FREE — no conflict when trial ends
      maxNodesPerCanvas: -1,          // unlimited — no conflict when trial ends
      maxCollaboratorsPerCanvas: 2,   // SAME as FREE — no conflict when trial ends
      maxCreditsPerMonth: 150,
    },
    features: {
      collaboration: true,
      customFlowExports: false,
      customAiPrompts: false,
      ragDocumentUpload: false,

      advancedAiModels: false,
      imageGeneration: true,
      videoGeneration: false,
      prioritySupport: false,
      importChat: false,
      vizoraInfographic: true,
    },
  },

  PLUS: {
    tier: 'PLUS',
    displayName: 'Plus',
    description: 'More power for serious creators',
    price: 1399, // $13.99
    currency: 'usd',
    billingPeriod: 'monthly',
    visible: true,
    limits: {
      maxProjects: -1,
      maxStorageMb: 5120, // 5 GB
      maxNodesPerCanvas: -1,
      maxCollaboratorsPerCanvas: 10,
      maxCreditsPerMonth: 1500,
    },
    features: {
      collaboration: true,
      customFlowExports: true,
      customAiPrompts: true,
      ragDocumentUpload: true,

      advancedAiModels: true,
      imageGeneration: true,
      videoGeneration: true,
      prioritySupport: false,
      importChat: true,
      vizoraInfographic: true,
    },
  },

  PRO: {
    tier: 'PRO',
    displayName: 'Professional',
    description: 'All features with maximum power',
    price: 2999, // $29.99
    currency: 'usd',
    billingPeriod: 'monthly',
    visible: true,
    limits: {
      maxProjects: -1,
      maxStorageMb: 20480, // 20 GB
      maxNodesPerCanvas: -1,
      maxCollaboratorsPerCanvas: -1,
      maxCreditsPerMonth: 5000,
    },
    features: {
      collaboration: true,
      customFlowExports: true,
      customAiPrompts: true,
      ragDocumentUpload: true,

      advancedAiModels: true,
      imageGeneration: true,
      videoGeneration: true,
      prioritySupport: true,
      importChat: true,
      vizoraInfographic: true,
    },
  },
};

// Helper: get plan or fallback to FREE
export function getPlanConfig(tier: string): PlanDefinition {
  return PLAN_CONFIG[tier] || PLAN_CONFIG.FREE;
}
