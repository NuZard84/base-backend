// ─── Plan Configuration (Source of Truth) ───────────────────────────────────
// This file defines all plan tiers, their limits, and feature flags.
// The frontend maintains a static mirror of this config for instant UI checks.
// Any changes here must be reflected in: base/src/lib/plan-config.ts

export interface PlanLimits {
  maxProjects: number; // -1 = unlimited
  maxAiTokensPerMonth: number;
  maxImageGenPerMonth: number;
  maxStorageMb: number;
  maxNodesPerCanvas: number;
  maxCollaboratorsPerCanvas: number; // -1 = unlimited
}

export interface PlanFeatures {
  collaboration: boolean;
  customFlowExports: boolean;
  customAiPrompts: boolean;
  ragDocumentUpload: boolean;
  apiAccess: boolean;
  advancedAiModels: boolean;
  imageGeneration: boolean;
  prioritySupport: boolean;
  importChat: boolean;
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
} as const;

// Limit type identifiers used by @CheckLimit decorator
export type LimitType =
  | 'projects'
  | 'ai_requests'
  | 'image_gen'
  | 'storage'
  | 'nodes_per_canvas'
  | 'collaborators';

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
      maxAiTokensPerMonth: 50_000,
      maxImageGenPerMonth: 4,
      maxStorageMb: 12,
      maxNodesPerCanvas: -1,
      maxCollaboratorsPerCanvas: 2,
    },
    features: {
      collaboration: true,
      customFlowExports: false,
      customAiPrompts: false,
      ragDocumentUpload: false,
      apiAccess: false,
      advancedAiModels: false,
      imageGeneration: true, // FREE gets 4/month (capped by maxImageGenPerMonth limit)
      prioritySupport: false,
      importChat: false,
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
      maxAiTokensPerMonth: 100_000,
      maxImageGenPerMonth: 8,
      maxStorageMb: 12,               // SAME as FREE — no conflict when trial ends
      maxNodesPerCanvas: -1,          // unlimited — no conflict when trial ends
      maxCollaboratorsPerCanvas: 2,   // SAME as FREE — no conflict when trial ends
    },
    features: {
      collaboration: true,
      customFlowExports: false,
      customAiPrompts: false,
      ragDocumentUpload: false,
      apiAccess: false,
      advancedAiModels: false,
      imageGeneration: true,
      prioritySupport: false,
      importChat: false,
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
      maxAiTokensPerMonth: 5_000_000,
      maxImageGenPerMonth: 80,
      maxStorageMb: 5120, // 5 GB
      maxNodesPerCanvas: -1,
      maxCollaboratorsPerCanvas: 10,
    },
    features: {
      collaboration: true,
      customFlowExports: true,
      customAiPrompts: true,
      ragDocumentUpload: true,
      apiAccess: false,
      advancedAiModels: true,
      imageGeneration: true,
      prioritySupport: false,
      importChat: true,
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
      maxAiTokensPerMonth: 20_000_000,
      maxImageGenPerMonth: 160,
      maxStorageMb: 20480, // 20 GB
      maxNodesPerCanvas: -1,
      maxCollaboratorsPerCanvas: -1,
    },
    features: {
      collaboration: true,
      customFlowExports: true,
      customAiPrompts: true,
      ragDocumentUpload: true,
      apiAccess: true,
      advancedAiModels: true,
      imageGeneration: true,
      prioritySupport: true,
      importChat: true,
    },
  },
};

// Helper: get plan or fallback to FREE
export function getPlanConfig(tier: string): PlanDefinition {
  return PLAN_CONFIG[tier] || PLAN_CONFIG.FREE;
}
