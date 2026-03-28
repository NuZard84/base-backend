// ─── Plan Configuration (Source of Truth) ───────────────────────────────────
// This file defines all plan tiers, their limits, and feature flags.
// The frontend maintains a static mirror of this config for instant UI checks.
// Any changes here must be reflected in: base/src/lib/plan-config.ts

export interface PlanLimits {
  maxProjects: number; // -1 = unlimited
  maxAiRequestsPerMonth: number;
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
    displayName: 'Free Starter',
    description: 'Get started with the basics',
    price: 0,
    currency: 'usd',
    billingPeriod: 'monthly',
    visible: true,
    limits: {
      maxProjects: 3,
      maxAiRequestsPerMonth: 100,
      maxImageGenPerMonth: 10,
      maxStorageMb: 10,
      maxNodesPerCanvas: 50,
      maxCollaboratorsPerCanvas: 0,
    },
    features: {
      collaboration: false,
      customFlowExports: false,
      customAiPrompts: false,
      ragDocumentUpload: false,
      apiAccess: false,
      advancedAiModels: false,
      imageGeneration: true, // FREE gets 10/month (capped by maxImageGenPerMonth limit)
      prioritySupport: false,
    },
  },

  STARTER: {
    tier: 'STARTER',
    displayName: 'Starter',
    description: 'For individuals getting serious',
    price: 500, // $5.00
    currency: 'usd',
    billingPeriod: 'monthly',
    visible: false, // hidden — reserved for future use
    limits: {
      maxProjects: 15,
      maxAiRequestsPerMonth: 500,
      maxImageGenPerMonth: 50,
      maxStorageMb: 500,
      maxNodesPerCanvas: 200,
      maxCollaboratorsPerCanvas: 2,
    },
    features: {
      collaboration: true,
      customFlowExports: false,
      customAiPrompts: true,
      ragDocumentUpload: false,
      apiAccess: false,
      advancedAiModels: false,
      imageGeneration: true,
      prioritySupport: false,
    },
  },

  PRO: {
    tier: 'PRO',
    displayName: 'Professional',
    description: 'For power users and creators',
    price: 1200, // $12.00
    currency: 'usd',
    billingPeriod: 'monthly',
    visible: true,
    limits: {
      maxProjects: -1,
      maxAiRequestsPerMonth: 2000,
      maxImageGenPerMonth: 200,
      maxStorageMb: 5120, // 5 GB
      maxNodesPerCanvas: 500,
      maxCollaboratorsPerCanvas: 5,
    },
    features: {
      collaboration: true,
      customFlowExports: true,
      customAiPrompts: true,
      ragDocumentUpload: true,
      apiAccess: false,
      advancedAiModels: true,
      imageGeneration: true,
      prioritySupport: true,
    },
  },

  ENTERPRISE: {
    tier: 'ENTERPRISE',
    displayName: 'Team Scale',
    description: 'For teams and organizations',
    price: 2900, // $29.00
    currency: 'usd',
    billingPeriod: 'monthly',
    visible: true,
    limits: {
      maxProjects: -1,
      maxAiRequestsPerMonth: 10000,
      maxImageGenPerMonth: 1000,
      maxStorageMb: 51200, // 50 GB
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
    },
  },
};

// Helper: get plan or fallback to FREE
export function getPlanConfig(tier: string): PlanDefinition {
  return PLAN_CONFIG[tier] || PLAN_CONFIG.FREE;
}
