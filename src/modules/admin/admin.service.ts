import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { PLAN_CONFIG } from '../../common/plans/plan-config';

export interface AdminAnalytics {
  totals: {
    users: number;
    guestUsers: number;
    canvases: number;
    aiConversations: number;
    imagesGenerated: number;
    filesUploaded: number;
    documentsUploaded: number;
    ragQueries: number;
    totalStorageMb: number;
    totalAiCostUsd: number;
  };
  planDistribution: { plan: string; count: number }[];
  statusDistribution: { status: string; count: number }[];
  trialUsers: number;
  activeToday: number;
  activeThisWeek: number;
  activeThisMonth: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  topUsageUsers: {
    userId: string;
    email: string;
    name: string | null;
    aiRequests: number;
    imageGen: number;
  }[];
  dailyNewUsers: { date: string; count: number }[];
  dailyAiRequests: { date: string; count: number }[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  trialTier: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  canvasCount: number;
  aiRequestsThisMonth: number;
  imageGenThisMonth: number;
  storageUsedMb: number;
}

export interface AdminUsersResult {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PlanOverrideConfig {
  tier: string;
  features: Record<string, boolean | null>; // null = using default
  limits: Record<string, number | null>;    // null = using default
}

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // ─── Analytics cache (60s TTL — the 8-query aggregate is expensive) ─────────
  private analyticsCache: { data: AdminAnalytics; expiresAt: number } | null = null;
  private readonly ANALYTICS_TTL_MS = 60_000;

  // ─── Analytics ─────────────────────────────────────────────────────────────

  async getAnalytics(force = false): Promise<AdminAnalytics> {
    if (!force && this.analyticsCache && Date.now() < this.analyticsCache.expiresAt) {
      return this.analyticsCache.data;
    }
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Days = new Date(now);
    last30Days.setDate(last30Days.getDate() - 30);

    const [
      totalUsers,
      guestUsers,
      totalCanvases,
      // AI requests: sum from UsageLog (AIConversation table may be empty
      // if the Gemini service doesn't write to it yet)
      totalAiRequestsResult,
      imagesGenResult,
      // Files: count from actual Attachment table (not UsageLog, which only
      // records uploads made after plan-gating was added)
      totalFilesUploaded,
      // Documents: count from actual Document table for the same reason
      totalDocumentsUploaded,
      totalRagQueries,
      // Storage: sum sizeBytes from both Attachment and Document tables
      attachmentStorage,
      documentStorage,
      costResult,
      planDist,
      statusDist,
      trialUsers,
      activeToday,
      activeWeek,
      activeMonth,
      newToday,
      newWeek,
      newMonth,
      topUsersAi,
      dailyNewUsersRaw,
      dailyAiRaw,
    ] = await Promise.all([
      this.prisma.user.count(),
      // Guest users: created via guest login (no googleId)
      this.prisma.user.count({ where: { googleId: null } }),
      this.prisma.canvas.count(),
      this.prisma.usageLog.aggregate({
        _sum: { quantity: true },
        where: { resourceType: 'ai_request' },
      }),
      this.prisma.usageLog.aggregate({
        _sum: { quantity: true },
        where: { resourceType: 'image_gen' },
      }),
      this.prisma.attachment.count(),
      this.prisma.document.count(),
      this.prisma.rAGQuery.count(),
      this.prisma.attachment.aggregate({ _sum: { sizeBytes: true } }),
      this.prisma.document.aggregate({ _sum: { sizeBytes: true } }),
      this.prisma.aIConversation.aggregate({ _sum: { costUsd: true } }),
      this.prisma.user.groupBy({
        by: ['plan'],
        _count: { plan: true },
      }),
      this.prisma.user.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      this.prisma.user.count({
        where: { trialEndsAt: { gt: now } },
      }),
      this.prisma.user.count({
        where: { lastLoginAt: { gte: startOfToday } },
      }),
      this.prisma.user.count({
        where: { lastLoginAt: { gte: startOfWeek } },
      }),
      this.prisma.user.count({
        where: { lastLoginAt: { gte: startOfMonth } },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: startOfWeek } },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      // Top users by AI requests this month
      this.prisma.usageLog.groupBy({
        by: ['userId'],
        _sum: { quantity: true },
        where: {
          resourceType: 'ai_request',
          createdAt: { gte: startOfMonth },
        },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),
      // Daily new users last 30 days
      this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE("createdAt")::text as date, COUNT(*)::bigint as count
        FROM users
        WHERE "createdAt" >= ${last30Days}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,
      // Daily AI requests last 30 days
      this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE("createdAt")::text as date, SUM(quantity)::bigint as count
        FROM usage_logs
        WHERE "resourceType" = 'ai_request' AND "createdAt" >= ${last30Days}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,
    ]);

    // Enrich top users with email/name
    const topUserIds = topUsersAi.map((u) => u.userId);
    const topUserDetails = await this.prisma.user.findMany({
      where: { id: { in: topUserIds } },
      select: { id: true, email: true, name: true },
    });
    const topUserMap = Object.fromEntries(topUserDetails.map((u) => [u.id, u]));

    // Top users image gen this month
    const topImageGen = await this.prisma.usageLog.groupBy({
      by: ['userId'],
      _sum: { quantity: true },
      where: {
        resourceType: 'image_gen',
        createdAt: { gte: startOfMonth },
        userId: { in: topUserIds },
      },
    });
    const imageGenMap = Object.fromEntries(
      topImageGen.map((u) => [u.userId, u._sum.quantity ?? 0]),
    );

    const totalStorageBytes =
      (attachmentStorage._sum.sizeBytes ?? 0) + (documentStorage._sum.sizeBytes ?? 0);

    const result: AdminAnalytics = {
      totals: {
        users: totalUsers,
        guestUsers,
        canvases: totalCanvases,
        aiConversations: totalAiRequestsResult._sum.quantity ?? 0,
        imagesGenerated: imagesGenResult._sum.quantity ?? 0,
        filesUploaded: totalFilesUploaded,
        documentsUploaded: totalDocumentsUploaded,
        ragQueries: totalRagQueries,
        totalStorageMb: Math.round(totalStorageBytes / (1024 * 1024)),
        totalAiCostUsd: Number(costResult._sum.costUsd ?? 0),
      },
      planDistribution: planDist.map((p) => ({
        plan: p.plan,
        count: p._count.plan,
      })),
      statusDistribution: statusDist.map((s) => ({
        status: s.status,
        count: s._count.status,
      })),
      trialUsers,
      activeToday,
      activeThisWeek: activeWeek,
      activeThisMonth: activeMonth,
      newUsersToday: newToday,
      newUsersThisWeek: newWeek,
      newUsersThisMonth: newMonth,
      topUsageUsers: topUsersAi.map((u) => ({
        userId: u.userId,
        email: topUserMap[u.userId]?.email ?? '',
        name: topUserMap[u.userId]?.name ?? null,
        aiRequests: u._sum.quantity ?? 0,
        imageGen: imageGenMap[u.userId] ?? 0,
      })),
      dailyNewUsers: dailyNewUsersRaw.map((r) => ({
        date: r.date,
        count: Number(r.count),
      })),
      dailyAiRequests: dailyAiRaw.map((r) => ({
        date: r.date,
        count: Number(r.count),
      })),
    };

    this.analyticsCache = { data: result, expiresAt: Date.now() + this.ANALYTICS_TTL_MS };
    return result;
  }

  // ─── Users ──────────────────────────────────────────────────────────────────

  async getUsers(
    page: number,
    pageSize: number,
    search?: string,
    planFilter?: string,
  ): Promise<AdminUsersResult> {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (planFilter) where.plan = planFilter;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [rawUsers, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          plan: true,
          status: true,
          trialEndsAt: true,
          trialTier: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { canvases: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Fetch usage in one query per resource type
    const userIds = rawUsers.map((u) => u.id);
    const [aiUsage, imageUsage, storageData] = await Promise.all([
      this.prisma.usageLog.groupBy({
        by: ['userId'],
        _sum: { quantity: true },
        where: { userId: { in: userIds }, resourceType: 'ai_request', createdAt: { gte: startOfMonth } },
      }),
      this.prisma.usageLog.groupBy({
        by: ['userId'],
        _sum: { quantity: true },
        where: { userId: { in: userIds }, resourceType: 'image_gen', createdAt: { gte: startOfMonth } },
      }),
      this.prisma.attachment.groupBy({
        by: ['userId'],
        _sum: { sizeBytes: true },
        where: { userId: { in: userIds } },
      }),
    ]);

    const aiMap = Object.fromEntries(aiUsage.map((u) => [u.userId, u._sum.quantity ?? 0]));
    const imgMap = Object.fromEntries(imageUsage.map((u) => [u.userId, u._sum.quantity ?? 0]));
    const storMap = Object.fromEntries(
      storageData.map((u) => [u.userId, Math.round((u._sum.sizeBytes ?? 0) / (1024 * 1024))]),
    );

    const users: AdminUserRow[] = rawUsers.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      image: u.image,
      plan: u.plan,
      status: u.status,
      trialEndsAt: u.trialEndsAt,
      trialTier: u.trialTier,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      canvasCount: u._count.canvases,
      aiRequestsThisMonth: aiMap[u.id] ?? 0,
      imageGenThisMonth: imgMap[u.id] ?? 0,
      storageUsedMb: storMap[u.id] ?? 0,
    }));

    return {
      users,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async updateUserPlan(
    userId: string,
    plan: string,
    trialEndsAt?: string | null,
    trialTier?: string | null,
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        plan: plan as any,
        trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
        trialTier: trialTier as any ?? null,
      },
      select: { id: true, email: true, plan: true, trialEndsAt: true, trialTier: true },
    });
  }

  // ─── Feature & Limit Overrides ──────────────────────────────────────────────

  async getPlanOverrides(): Promise<PlanOverrideConfig[]> {
    const [featureOverrides, limitOverrides] = await Promise.all([
      this.prisma.planFeatureOverride.findMany(),
      this.prisma.planLimitOverride.findMany(),
    ]);

    const tiers = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];
    return tiers.map((tier) => {
      const baseConfig = PLAN_CONFIG[tier];
      const tierFeatureOverrides = featureOverrides.filter((o) => o.tier === tier);
      const tierLimitOverrides = limitOverrides.filter((o) => o.tier === tier);

      const features: Record<string, boolean | null> = {};
      for (const key of Object.keys(baseConfig.features)) {
        const override = tierFeatureOverrides.find((o) => o.feature === key);
        features[key] = override ? override.enabled : null;
      }

      const limits: Record<string, number | null> = {};
      for (const key of Object.keys(baseConfig.limits)) {
        const override = tierLimitOverrides.find((o) => o.limitKey === key);
        limits[key] = override ? override.value : null;
      }

      return { tier, features, limits };
    });
  }

  async setFeatureOverride(tier: string, feature: string, enabled: boolean | null) {
    if (enabled === null) {
      // Remove override — fall back to static config
      await this.prisma.planFeatureOverride.deleteMany({
        where: { tier: tier as any, feature },
      });
      return { tier, feature, enabled: null };
    }
    return this.prisma.planFeatureOverride.upsert({
      where: { tier_feature: { tier: tier as any, feature } },
      create: { tier: tier as any, feature, enabled },
      update: { enabled },
    });
  }

  async setLimitOverride(tier: string, limitKey: string, value: number | null) {
    if (value === null) {
      await this.prisma.planLimitOverride.deleteMany({
        where: { tier: tier as any, limitKey },
      });
      return { tier, limitKey, value: null };
    }
    return this.prisma.planLimitOverride.upsert({
      where: { tier_limitKey: { tier: tier as any, limitKey } },
      create: { tier: tier as any, limitKey, value },
      update: { value },
    });
  }

  async resetAllOverridesForTier(tier: string) {
    await Promise.all([
      this.prisma.planFeatureOverride.deleteMany({ where: { tier: tier as any } }),
      this.prisma.planLimitOverride.deleteMany({ where: { tier: tier as any } }),
    ]);
    return { tier, reset: true };
  }

  // ─── App Config ─────────────────────────────────────────────────────────────

  async getAppConfig(): Promise<Record<string, string>> {
    const rows = await this.prisma.appConfig.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async setAppConfig(key: string, value: string) {
    return this.prisma.appConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /** Read a single config value with a fallback default. */
  async getConfigValue(key: string, defaultValue: string): Promise<string> {
    const row = await this.prisma.appConfig.findUnique({ where: { key } });
    return row?.value ?? defaultValue;
  }

  // ─── Revenue (stub — populated once Stripe/Razorpay is integrated) ──────────

  async getRevenueAnalytics(_gateway?: string) {
    // Compute MRR/ARR estimate from active paid subscriptions using plan pricing
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Paid plan prices in USD (mirrors plan-config displayPrice)
    const PLAN_PRICE_USD: Record<string, number> = {
      FREE: 0,
      STARTER: 0,
      PRO: 12,
      ENTERPRISE: 29,
    };

    const [planCounts, newPaidThisMonth, newPaidLastMonth] = await Promise.all([
      // Active paid users per plan
      this.prisma.user.groupBy({
        by: ['plan'],
        _count: { plan: true },
        where: { status: 'ACTIVE', plan: { in: ['PRO', 'ENTERPRISE'] } },
      }),
      // New paid subscribers this month (rough proxy)
      this.prisma.user.count({
        where: { plan: { in: ['PRO', 'ENTERPRISE'] }, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.user.count({
        where: {
          plan: { in: ['PRO', 'ENTERPRISE'] },
          createdAt: { gte: startOfLastMonth, lt: startOfMonth },
        },
      }),
    ]);

    const mrr = planCounts.reduce((sum, p) => {
      return sum + (PLAN_PRICE_USD[p.plan] ?? 0) * p._count.plan;
    }, 0);

    // Monthly revenue for last 12 months (proxy: MRR-equivalent per month using signup data)
    const months: { month: string; revenue: number; subscriptions: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

      // Count paid users active in that month (approximation: created before end of month)
      const [proCount, entCount] = await Promise.all([
        this.prisma.user.count({ where: { plan: 'PRO', createdAt: { lt: nextD } } }),
        this.prisma.user.count({ where: { plan: 'ENTERPRISE', createdAt: { lt: nextD } } }),
      ]);
      const rev = proCount * PLAN_PRICE_USD.PRO + entCount * PLAN_PRICE_USD.ENTERPRISE;
      months.push({ month: label, revenue: rev, subscriptions: proCount + entCount });
    }

    // Plan revenue breakdown
    const allPlanCounts = await this.prisma.user.groupBy({
      by: ['plan'],
      _count: { plan: true },
      where: { status: 'ACTIVE' },
    });
    const planRevenue = allPlanCounts.map((p) => ({
      plan: p.plan,
      revenue: (PLAN_PRICE_USD[p.plan] ?? 0) * p._count.plan,
      count: p._count.plan,
    }));

    const activeSubscriptions = planCounts.reduce((s, p) => s + p._count.plan, 0);

    return {
      summary: {
        mrr,
        arr: mrr * 12,
        revenueThisMonth: mrr, // proxy
        totalRevenue: months.reduce((s, m) => s + m.revenue, 0),
        activeSubscriptions,
        newSubscriptionsThisMonth: newPaidThisMonth,
        churnedThisMonth: Math.max(0, newPaidLastMonth - newPaidThisMonth),
      },
      monthlyRevenue: months,
      planRevenue,
      // Will be populated once Stripe/Razorpay webhooks are set up
      connectedGateways: [] as string[],
    };
  }

  async getTransactions(
    page: number,
    pageSize: number,
    _gateway?: string,
    _status?: string,
    _search?: string,
  ) {
    // Stub — returns empty until payment gateway is integrated
    return {
      transactions: [] as any[],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
    };
  }
}
