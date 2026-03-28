import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanService } from './plan.service';
import { PLAN_FEATURE_KEY, PLAN_LIMIT_KEY } from './plan.decorator';
import type { FeatureKey, LimitType } from './plan-config';

/**
 * PlanGuard — Enforces plan-based feature flags and usage limits.
 *
 * Must be stacked AFTER JwtAuthGuard so that `request.user.userId` is available.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, PlanGuard)
 *   @RequireFeature('collaboration')
 *   @CheckLimit('projects')
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly planService: PlanService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.userId;

    // If no authenticated user, let other guards handle it
    if (!userId) return true;

    // Check feature flag requirement
    const requiredFeature = this.reflector.getAllAndOverride<
      FeatureKey | undefined
    >(PLAN_FEATURE_KEY, [context.getHandler(), context.getClass()]);

    if (requiredFeature) {
      // Throws ForbiddenException if feature unavailable
      await this.planService.requireFeature(userId, requiredFeature);
    }

    // Check usage limit requirement
    const limitType = this.reflector.getAllAndOverride<LimitType | undefined>(
      PLAN_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (limitType) {
      // Extract context for per-canvas limits
      const canvasId =
        request.params?.id || request.params?.canvasId || request.body?.canvasId;

      await this.planService.checkLimit(userId, limitType, { canvasId });
    }

    return true;
  }
}
