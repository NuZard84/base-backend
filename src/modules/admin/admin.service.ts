import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { PLAN_CONFIG } from '../../common/plans/plan-config';
import { StripeService } from '../stripe/stripe.service';
import { PlanTier, PaymentStatus, SubscriptionStatus } from '@prisma/client';

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
  aiTokensThisMonth: number;
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

// Price ID → PlanTier map (loaded lazily from env via StripeService config)
const PRICE_TO_TIER: Record<string, PlanTier> = {};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
  ) {}

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
    const [aiUsage, aiTokenUsage, imageUsage, storageData] = await Promise.all([
      this.prisma.usageLog.groupBy({
        by: ['userId'],
        _sum: { quantity: true },
        where: { userId: { in: userIds }, resourceType: 'ai_request', createdAt: { gte: startOfMonth } },
      }),
      this.prisma.usageLog.groupBy({
        by: ['userId'],
        _sum: { tokensUsed: true },
        where: { userId: { in: userIds }, resourceType: 'ai_request', createdAt: { gte: startOfMonth }, tokensUsed: { not: null } },
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
    const aiTokenMap = Object.fromEntries(aiTokenUsage.map((u) => [u.userId, u._sum.tokensUsed ?? 0]));
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
      aiTokensThisMonth: aiTokenMap[u.id] ?? 0,
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

    const tiers = ['FREE', 'STARTER', 'PLUS', 'PRO'];
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

  // ─── Maintenance ─────────────────────────────────────────────────────────────

  /**
   * Delete revoked sessions older than 7 days.
   * Exposed via POST /admin/maintenance/cleanup so Cloud Scheduler can trigger
   * this externally — ensures it runs even if the in-process BullMQ job misses
   * its window (e.g. after a Cloud Run restart at 2 AM).
   */
  async cleanupRevokedSessions(): Promise<{ deletedCount: number }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const result = await this.prisma.session.deleteMany({
      where: { isRevoked: true, createdAt: { lt: sevenDaysAgo } },
    });
    return { deletedCount: result.count };
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

  // ─── Revenue ─────────────────────────────────────────────────────────────────

  async getRevenueAnalytics(_gateway?: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = startOfMonth;

    // ── Real revenue from Payment table ──────────────────────────────────────

    const [
      revenueThisMonthRaw,
      totalRevenueRaw,
      activeSubscriptions,
      newPaidThisMonth,
      newPaidLastMonth,
      paymentCount,
    ] = await Promise.all([
      // Actual revenue collected this month (SUCCEEDED payments)
      this.prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: { status: 'SUCCEEDED', createdAt: { gte: startOfMonth } },
      }),
      // All-time total revenue (SUCCEEDED only, exclude refunds)
      this.prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: { status: 'SUCCEEDED' },
      }),
      // Active paid subscribers
      this.prisma.user.count({
        where: { status: 'ACTIVE', plan: { in: ['PRO', 'PLUS'] } },
      }),
      // New paid this month
      this.prisma.user.count({
        where: { plan: { in: ['PRO', 'PLUS'] }, createdAt: { gte: startOfMonth } },
      }),
      // New paid last month (for churn calc)
      this.prisma.user.count({
        where: { plan: { in: ['PRO', 'PLUS'] }, createdAt: { gte: startOfLastMonth, lt: endOfLastMonth } },
      }),
      // Whether we have any real payment data
      this.prisma.payment.count(),
    ]);

    // MRR — use real payment data if available, fall back to subscription count estimate
    const PLAN_PRICE_CENTS: Record<string, number> = { PLUS: 1399, PRO: 2999 };
    let mrrCents = revenueThisMonthRaw._sum.amountCents ?? 0;
    if (mrrCents === 0) {
      // Estimate from active subscriptions (fallback before any payments)
      const planCounts = await this.prisma.user.groupBy({
        by: ['plan'],
        _count: { plan: true },
        where: { status: 'ACTIVE', plan: { in: ['PRO', 'PLUS'] } },
      });
      mrrCents = planCounts.reduce((s, p) => s + (PLAN_PRICE_CENTS[p.plan] ?? 0) * p._count.plan, 0);
    }
    const mrrUsd = Math.round(mrrCents / 100);

    // ── Monthly revenue — last 12 months from Payment table ──────────────────

    const months: { month: string; revenue: number; subscriptions: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

      const [revRaw, subCount] = await Promise.all([
        this.prisma.payment.aggregate({
          _sum: { amountCents: true },
          where: { status: 'SUCCEEDED', createdAt: { gte: d, lt: nextD } },
        }),
        this.prisma.user.count({
          where: { plan: { in: ['PRO', 'PLUS'] }, createdAt: { lt: nextD } },
        }),
      ]);

      months.push({
        month: label,
        revenue: Math.round((revRaw._sum.amountCents ?? 0) / 100),
        subscriptions: subCount,
      });
    }

    // ── Plan revenue breakdown ────────────────────────────────────────────────

    const planPayments = await this.prisma.payment.groupBy({
      by: ['plan'],
      _sum: { amountCents: true },
      _count: { plan: true },
      where: { status: 'SUCCEEDED' },
    });
    const planRevenue = planPayments.map((p) => ({
      plan: p.plan,
      revenue: Math.round((p._sum.amountCents ?? 0) / 100),
      count: p._count.plan,
    }));

    const totalRevenueUsd = Math.round((totalRevenueRaw._sum.amountCents ?? 0) / 100);
    const revenueThisMonthUsd = Math.round((revenueThisMonthRaw._sum.amountCents ?? 0) / 100);

    return {
      summary: {
        mrr: mrrUsd,
        arr: mrrUsd * 12,
        revenueThisMonth: revenueThisMonthUsd,
        totalRevenue: totalRevenueUsd,
        activeSubscriptions,
        newSubscriptionsThisMonth: newPaidThisMonth,
        churnedThisMonth: Math.max(0, newPaidLastMonth - newPaidThisMonth),
      },
      monthlyRevenue: months,
      planRevenue,
      connectedGateways: paymentCount > 0 ? ['stripe'] : [],
    };
  }

  /**
   * Pull the user's current subscription + invoice state from Stripe and
   * write it into the DB. Fixes plan/status drift when webhooks were missed.
   */
  async syncUserFromStripe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, stripeId: true, subscriptionId: true, plan: true },
    });

    if (!user.stripeId) {
      return { synced: false, reason: 'User has no Stripe customer ID — never completed a checkout' };
    }

    this.logger.log(`Syncing user ${userId} (${user.email}) from Stripe customer ${user.stripeId}`);

    // ── 1. Sync plan + subscription status ────────────────────────────────────
    const subscriptions = await this.stripeService.listActiveSubscriptions(user.stripeId);
    const activeSub = subscriptions.find((s) =>
      ['active', 'trialing', 'past_due', 'paused'].includes(s.status),
    ) ?? subscriptions[0];

    const PRICE_ENV: Record<string, PlanTier> = {
      [process.env.STRIPE_PRICE_PLUS ?? '']: PlanTier.PLUS,
      [process.env.STRIPE_PRICE_PRO ?? '']: PlanTier.PRO,
      [process.env.STRIPE_PRICE_STARTER ?? '']: PlanTier.STARTER,
    };

    let newPlan: PlanTier = PlanTier.FREE;
    let newStatus: SubscriptionStatus = SubscriptionStatus.ACTIVE;
    let subscriptionId: string | null = null;

    if (activeSub) {
      const priceId = activeSub.items.data[0]?.price?.id ?? '';
      newPlan = PRICE_ENV[priceId] ?? PlanTier.FREE;
      subscriptionId = activeSub.id;
      switch (activeSub.status) {
        case 'active':    newStatus = SubscriptionStatus.ACTIVE; break;
        case 'trialing':  newStatus = SubscriptionStatus.TRIALING; break;
        case 'past_due':
        case 'paused':
        case 'incomplete': newStatus = SubscriptionStatus.PAUSED; break;
        case 'canceled':  newStatus = SubscriptionStatus.CANCELED; newPlan = PlanTier.FREE; subscriptionId = null; break;
      }
    }

    const isPaid = newPlan === PlanTier.PLUS || newPlan === PlanTier.PRO;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        plan: newPlan,
        status: newStatus,
        subscriptionId,
        ...(isPaid && { trialEndsAt: null, trialTier: null }),
      },
    });

    this.logger.log(`Synced user ${userId}: plan=${newPlan} status=${newStatus} sub=${subscriptionId}`);

    // ── 2. Backfill missing Payment records from Stripe invoices ──────────────
    const invoices = await this.stripeService.listPaidInvoices(user.stripeId, 20);
    let invoicesCreated = 0;

    for (const inv of invoices) {
      if (!inv.id) continue;
      const exists = await this.prisma.payment.findUnique({ where: { stripeInvoiceId: inv.id } });
      if (exists) continue;

      const lineItem = (inv as any).lines?.data?.[0];
      const priceId = lineItem?.price?.id ?? '';
      const plan = PRICE_ENV[priceId] ?? newPlan;
      const periodStart = lineItem?.period?.start ? new Date(lineItem.period.start * 1000) : null;
      const periodEnd   = lineItem?.period?.end   ? new Date(lineItem.period.end   * 1000) : null;

      await this.prisma.payment.create({
        data: {
          userId,
          stripeInvoiceId: inv.id,
          plan,
          amountCents: (inv as any).amount_paid ?? 0,
          currency: inv.currency ?? 'usd',
          status: PaymentStatus.SUCCEEDED,
          periodStart,
          periodEnd,
          invoiceUrl: (inv as any).hosted_invoice_url ?? null,
          invoicePdf: (inv as any).invoice_pdf ?? null,
          createdAt: new Date((inv as any).created * 1000),
        },
      });
      invoicesCreated++;
    }

    this.logger.log(`Backfilled ${invoicesCreated} invoice(s) for user ${userId}`);

    return {
      synced: true,
      plan: newPlan,
      status: newStatus,
      subscriptionId,
      invoicesBackfilled: invoicesCreated,
    };
  }

  async getWebhookLogs(page: number, pageSize: number, status?: string, eventType?: string) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (status && status !== 'All') where.status = status;
    if (eventType && eventType !== 'All') where.eventType = { contains: eventType, mode: 'insensitive' };

    const [logs, total] = await Promise.all([
      this.prisma.webhookLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          eventId: true,
          eventType: true,
          status: true,
          error: true,
          userId: true,
          processedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.webhookLog.count({ where }),
    ]);

    return { logs, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getTransactions(
    page: number,
    pageSize: number,
    _gateway?: string,
    status?: string,
    search?: string,
  ) {
    const skip = (page - 1) * pageSize;

    // Build search filter — match on user email or stripeInvoiceId
    const searchFilter = search
      ? {
          OR: [
            { stripeInvoiceId: { contains: search, mode: 'insensitive' as const } },
            { user: { email: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {};

    const statusFilter = status && status !== 'All' ? { status: status as any } : {};

    const where = { ...searchFilter, ...statusFilter };

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          user: { select: { email: true, name: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    const transactions = payments.map((p) => ({
      id: p.id,
      date: p.createdAt.toISOString(),
      userEmail: p.user.email,
      userName: p.user.name,
      plan: p.plan,
      amount: p.amountCents,
      currency: p.currency,
      gateway: 'stripe' as const,
      status: p.status,
      transactionId: p.stripeInvoiceId ?? p.id,
      invoiceUrl: p.invoiceUrl,
      invoicePdf: p.invoicePdf,
    }));

    return {
      transactions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
