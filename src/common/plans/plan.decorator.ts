import { SetMetadata } from '@nestjs/common';
import type { FeatureKey, LimitType } from './plan-config';

// ─── @RequireFeature('collaboration') ─────────────────────────────────────────
// Marks an endpoint as requiring a specific plan feature.
// Used by PlanGuard to check if the user's plan has the feature enabled.

export const PLAN_FEATURE_KEY = 'plan:require_feature';
export const RequireFeature = (feature: FeatureKey) =>
  SetMetadata(PLAN_FEATURE_KEY, feature);

// ─── @CheckLimit('projects') ──────────────────────────────────────────────────
// Marks an endpoint as requiring a usage limit check before proceeding.
// Used by PlanGuard to verify the user hasn't exceeded the limit.

export const PLAN_LIMIT_KEY = 'plan:check_limit';
export const CheckLimit = (limitType: LimitType) =>
  SetMetadata(PLAN_LIMIT_KEY, limitType);
