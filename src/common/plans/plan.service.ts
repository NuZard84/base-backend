import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import {
  PLAN_CONFIG,
  getPlanConfig,
  RESOURCE_TYPES,
  type PlanDefinition,
  type LimitType,
  type FeatureKey,
} from './plan-config';

export interface UsageCount {
  current: number;
  limit: number; // -1 = unlimited
  resetAt?: string; // ISO date — for monthly-reset resources
}

export interface UserPlanDetails {
  plan: PlanDefinition;
  actualTier: string;
  status: string;
  nextBillingAt: string | null;
  trial: {
    active: boolean;
    tier: string | null;
    endsAt: string | null;
    daysRemaining: number;
  };
  usage: {
    projects: UsageCount;
    aiRequests: UsageCount;
    imageGen: UsageCount;
    storageMb: UsageCount;
  };
}

@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Effective Plan Resolution ──────────────────────────────────────────────

  async getEffectivePlan(userId: string): Promise<PlanDefinition> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, trialEndsAt: true, trialTier: true },
    });

    // If trial is active, use trial tier
    const tier =
      user.trialEndsAt && user.trialTier && new Date(user.trialEndsAt) > new Date()
        ? user.trialTier
        : user.plan;

    const basePlan = getPlanConfig(tier);
    return this.applyOverrides(basePlan);
  }

  /** Apply any admin overrides from DB on top of the static plan config. */
  private async applyOverrides(base: PlanDefinition): Promise<PlanDefinition> {
    const [featureOverrides, limitOverrides] = await Promise.all([
      this.prisma.planFeatureOverride.findMany({ where: { tier: base.tier as any } }),
      this.prisma.planLimitOverride.findMany({ where: { tier: base.tier as any } }),
    ]);

    if (featureOverrides.length === 0 && limitOverrides.length === 0) return base;

    const features = { ...base.features };
    for (const o of featureOverrides) {
      (features as any)[o.feature] = o.enabled;
    }

    const limits = { ...base.limits };
    for (const o of limitOverrides) {
      (limits as any)[o.limitKey] = o.value;
    }

    return { ...base, features, limits };
  }

  // ─── Feature Checks ────────────────────────────────────────────────────────

  async hasFeature(userId: string, feature: FeatureKey): Promise<boolean> {
    const plan = await this.getEffectivePlan(userId);
    return plan.features[feature] === true;
  }

  // ─── Usage Counting ────────────────────────────────────────────────────────

  private getMonthStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  private getMonthEnd(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  async countProjects(userId: string): Promise<number> {
    return this.prisma.canvas.count({ where: { userId } });
  }

  async countMonthlyAiRequests(userId: string): Promise<number> {
    const result = await this.prisma.usageLog.aggregate({
      where: {
        userId,
        resourceType: RESOURCE_TYPES.AI_REQUEST,
        createdAt: { gte: this.getMonthStart() },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  async countMonthlyAiTokens(userId: string): Promise<number> {
    const monthStart = this.getMonthStart();

    // Sum token counts for rows that have tokensUsed populated
    const tokenSum = await this.prisma.usageLog.aggregate({
      where: {
        userId,
        resourceType: RESOURCE_TYPES.AI_REQUEST,
        createdAt: { gte: monthStart },
        tokensUsed: { not: null },
      },
      _sum: { tokensUsed: true },
    });

    // For pre-migration rows (tokensUsed IS NULL), count each as 1 token
    // so legacy data still contributes to the quota. Remove this after one full billing cycle.
    const legacyCount = await this.prisma.usageLog.count({
      where: {
        userId,
        resourceType: RESOURCE_TYPES.AI_REQUEST,
        createdAt: { gte: monthStart },
        tokensUsed: null,
      },
    });

    return (tokenSum._sum.tokensUsed ?? 0) + legacyCount;
  }

  async countMonthlyImageGen(userId: string): Promise<number> {
    const result = await this.prisma.usageLog.aggregate({
      where: {
        userId,
        resourceType: RESOURCE_TYPES.IMAGE_GEN,
        createdAt: { gte: this.getMonthStart() },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  async countMonthlyVizora(userId: string): Promise<number> {
    const result = await this.prisma.usageLog.aggregate({
      where: {
        userId,
        resourceType: RESOURCE_TYPES.VIZORA_GEN,
        createdAt: { gte: this.getMonthStart() },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  async countStorageMb(userId: string): Promise<number> {
    const [attachments, documents] = await Promise.all([
      this.prisma.attachment.aggregate({
        where: { userId },
        _sum: { sizeBytes: true },
      }),
      this.prisma.document.aggregate({
        where: { userId },
        _sum: { sizeBytes: true },
      }),
    ]);
    const totalBytes =
      (attachments._sum.sizeBytes ?? 0) + (documents._sum.sizeBytes ?? 0);
    return Math.round((totalBytes / (1024 * 1024)) * 100) / 100; // MB with 2 decimals
  }

  async countNodesInCanvas(canvasId: string): Promise<number> {
    const canvas = await this.prisma.canvas.findUnique({
      where: { id: canvasId },
      select: { nodeCount: true },
    });
    return canvas?.nodeCount ?? 0;
  }

  async countCollaborators(canvasId: string): Promise<number> {
    const shareCount = await this.prisma.canvasShare.count({
      where: {
        canvasId,
        status: { in: ['ACTIVE', 'PENDING'] },
      },
    });
    return shareCount + 1; // +1 for the owner (not stored in CanvasShare table)
  }

  // ─── Limit Enforcement ─────────────────────────────────────────────────────

  /**
   * Check if the user has reached a limit. Throws ForbiddenException if exceeded.
   * @param context - optional context (e.g. canvasId for per-canvas limits)
   */
  async checkLimit(
    userId: string,
    limitType: LimitType,
    context?: { canvasId?: string },
  ): Promise<void> {
    const plan = await this.getEffectivePlan(userId);

    switch (limitType) {
      case 'projects': {
        const limit = plan.limits.maxProjects;
        if (limit === -1) return; // unlimited
        const current = await this.countProjects(userId);
        if (current >= limit) {
          throw new ForbiddenException({
            code: 'PLAN_LIMIT_EXCEEDED',
            limitType: 'projects',
            current,
            limit,
            message: `You've reached your project limit (${current}/${limit}). Upgrade your plan to create more projects.`,
          });
        }
        break;
      }

      case 'ai_requests': {
        const limit = plan.limits.maxAiTokensPerMonth;
        if (limit === -1) return;
        const current = await this.countMonthlyAiTokens(userId);
        if (current >= limit) {
          throw new ForbiddenException({
            code: 'PLAN_LIMIT_EXCEEDED',
            limitType: 'ai_requests',
            current,
            limit,
            resetAt: this.getMonthEnd().toISOString(),
            message: `You've used ${current.toLocaleString()} of your ${limit.toLocaleString()} monthly AI tokens. Resets on ${this.getMonthEnd().toLocaleDateString()}.`,
          });
        }
        break;
      }

      case 'image_gen': {
        const limit = plan.limits.maxImageGenPerMonth;
        if (limit === -1) return;
        const current = await this.countMonthlyImageGen(userId);
        if (current >= limit) {
          throw new ForbiddenException({
            code: 'PLAN_LIMIT_EXCEEDED',
            limitType: 'image_gen',
            current,
            limit,
            resetAt: this.getMonthEnd().toISOString(),
            message: `You've used all your image generations this month (${current}/${limit}). Resets on ${this.getMonthEnd().toLocaleDateString()}.`,
          });
        }
        break;
      }

      case 'storage': {
        const limit = plan.limits.maxStorageMb;
        if (limit === -1) return;
        const current = await this.countStorageMb(userId);
        if (current >= limit) {
          throw new ForbiddenException({
            code: 'PLAN_LIMIT_EXCEEDED',
            limitType: 'storage',
            current,
            limit,
            message: `You've reached your storage limit (${current.toFixed(1)}MB/${limit}MB). Upgrade to get more storage.`,
          });
        }
        break;
      }

      case 'nodes_per_canvas': {
        if (!context?.canvasId) return;
        const limit = plan.limits.maxNodesPerCanvas;
        if (limit === -1) return;
        const current = await this.countNodesInCanvas(context.canvasId);
        if (current >= limit) {
          throw new ForbiddenException({
            code: 'PLAN_LIMIT_EXCEEDED',
            limitType: 'nodes_per_canvas',
            current,
            limit,
            message: `This canvas has reached the node limit (${current}/${limit}). Upgrade your plan for more nodes per canvas.`,
          });
        }
        break;
      }

      case 'collaborators': {
        if (!context?.canvasId) return;
        const limit = plan.limits.maxCollaboratorsPerCanvas;
        if (limit === -1) return;
        const current = await this.countCollaborators(context.canvasId);
        if (current >= limit) {
          throw new ForbiddenException({
            code: 'PLAN_LIMIT_EXCEEDED',
            limitType: 'collaborators',
            current,
            limit,
            message: `This canvas has reached the collaborator limit (${current}/${limit}). Upgrade for more collaborators.`,
          });
        }
        break;
      }

      case 'vizora_gen': {
        const limit = plan.limits.maxVizoraPerMonth;
        if (limit === -1) return;
        const current = await this.countMonthlyVizora(userId);
        if (current >= limit) {
          throw new ForbiddenException({
            code: 'PLAN_LIMIT_EXCEEDED',
            limitType: 'vizora_gen',
            current,
            limit,
            resetAt: this.getMonthEnd().toISOString(),
            message: `You've used all your Vizora Infographic Visuals this month (${current}/${limit}). Resets on ${this.getMonthEnd().toLocaleDateString()}.`,
          });
        }
        break;
      }
    }
  }

  // ─── Feature Enforcement ────────────────────────────────────────────────────

  async requireFeature(userId: string, feature: FeatureKey): Promise<void> {
    const plan = await this.getEffectivePlan(userId);
    if (!plan.features[feature]) {
      throw new ForbiddenException({
        code: 'PLAN_FEATURE_UNAVAILABLE',
        feature,
        currentTier: plan.tier,
        message: `The "${feature}" feature is not available on your ${plan.displayName} plan. Upgrade to access this feature.`,
      });
    }
  }

  // ─── Usage Logging ──────────────────────────────────────────────────────────

  async logUsage(
    userId: string,
    resourceType: string,
    quantity: number = 1,
    metadata: Record<string, any> = {},
    tokensUsed?: number,
  ): Promise<void> {
    await this.prisma.usageLog.create({
      data: {
        userId,
        resourceType,
        quantity,
        tokensUsed: tokensUsed ?? null,
        metadata: metadata as any,
      },
    });
  }

  // ─── Usage Summary (for API responses) ──────────────────────────────────────

  async getUsageSummary(userId: string): Promise<{
    projects: UsageCount;
    aiRequests: UsageCount;
    imageGen: UsageCount;
    storageMb: UsageCount;
    vizoraGen: UsageCount;
  }> {
    const plan = await this.getEffectivePlan(userId);
    const resetAt = this.getMonthEnd().toISOString();

    const [projects, aiTokens, imageGen, storageMb, vizoraGen] = await Promise.all([
      this.countProjects(userId),
      this.countMonthlyAiTokens(userId),
      this.countMonthlyImageGen(userId),
      this.countStorageMb(userId),
      this.countMonthlyVizora(userId),
    ]);

    return {
      projects: {
        current: projects,
        limit: plan.limits.maxProjects,
      },
      aiRequests: {
        current: aiTokens,
        limit: plan.limits.maxAiTokensPerMonth,
        resetAt,
      },
      imageGen: {
        current: imageGen,
        limit: plan.limits.maxImageGenPerMonth,
        resetAt,
      },
      storageMb: {
        current: storageMb,
        limit: plan.limits.maxStorageMb,
      },
      vizoraGen: {
        current: vizoraGen,
        limit: plan.limits.maxVizoraPerMonth,
        resetAt,
      },
    };
  }

  // ─── Full Plan Details (for frontend) ───────────────────────────────────────

  async getUserPlanDetails(userId: string): Promise<UserPlanDetails> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, status: true, trialEndsAt: true, trialTier: true },
    });

    // A paid plan always supersedes any active trial — guard against stale
    // trial fields if they weren't cleared when the subscription was activated.
    const hasPaidPlan = user.plan === 'PLUS' || user.plan === 'PRO';
    const isTrialActive =
      !hasPaidPlan &&
      !!user.trialEndsAt &&
      !!user.trialTier &&
      new Date(user.trialEndsAt) > new Date();

    const effectivePlan = isTrialActive
      ? getPlanConfig(user.trialTier!)
      : getPlanConfig(user.plan);

    const daysRemaining = isTrialActive
      ? Math.max(
          0,
          Math.ceil(
            (new Date(user.trialEndsAt!).getTime() - Date.now()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

    const [usage, latestPayment] = await Promise.all([
      this.getUsageSummary(userId),
      this.prisma.payment.findFirst({
        where: { userId, status: 'SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
        select: { periodEnd: true },
      }),
    ]);

    const nextBillingAt = latestPayment?.periodEnd?.toISOString() ?? null;

    return {
      plan: effectivePlan,
      actualTier: user.plan,
      status: user.status,
      nextBillingAt,
      trial: {
        active: isTrialActive,
        tier: user.trialTier,
        endsAt: user.trialEndsAt?.toISOString() ?? null,
        daysRemaining,
      },
      usage,
    };
  }

  // ─── All Plans (public) ─────────────────────────────────────────────────────

  getVisiblePlans(): PlanDefinition[] {
    return Object.values(PLAN_CONFIG).filter((p) => p.visible);
  }
}
