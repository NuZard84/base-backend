import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreditTxType } from '@prisma/client';
import { getPlanConfig } from '../plans/plan-config';
import { SocketService } from '../socket/socket.service';
import {
  DEFAULT_CREDIT_COSTS,
  CREDIT_COST_PREFIX,
  CREDITS_ENABLED_KEY,
} from './credit-costs';

export interface CreditBalance {
  balance: number;
}

export interface CreditHistoryItem {
  id: string;
  amount: number;
  balance: number;
  type: CreditTxType;
  reason: string;
  resourceType: string | null;
  createdAt: string;
}

// AppConfig rows are tiny strings — a short in-process cache avoids a DB
// round-trip on every request. TTL matches the AdminService analytics cache.
const COST_CACHE_TTL_MS = 60_000;

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  // cost cache: key → { value, expiresAt }
  private readonly costCache = new Map<string, { value: number; expiresAt: number }>();
  // credits_enabled cache
  private creditsEnabledCache: { value: boolean; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly socketService: SocketService,
  ) {}

  // ─── Cost resolution (cache → AppConfig → static default) ────────────────────

  async getCost(key: string): Promise<number> {
    const cached = this.costCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    const row = await this.prisma.appConfig.findUnique({
      where: { key: `${CREDIT_COST_PREFIX}${key}` },
    });

    const value = row ? parseInt(row.value, 10) : (DEFAULT_CREDIT_COSTS[key] ?? 0);
    this.costCache.set(key, { value, expiresAt: Date.now() + COST_CACHE_TTL_MS });
    return value;
  }

  /** Resolve video gen cost key from mode + duration (seconds as string). */
  videoGenCostKey(mode: string, duration: string | number): string {
    return `video_gen:${mode}:${duration}`;
  }

  // ─── credits_enabled flag ─────────────────────────────────────────────────────

  async isCreditsEnabled(): Promise<boolean> {
    if (this.creditsEnabledCache && Date.now() < this.creditsEnabledCache.expiresAt) {
      return this.creditsEnabledCache.value;
    }
    const row = await this.prisma.appConfig.findUnique({ where: { key: CREDITS_ENABLED_KEY } });
    // Default to true — admin panel can set to 'false' as a kill-switch
    const value = row === null || row.value !== 'false';
    this.creditsEnabledCache = { value, expiresAt: Date.now() + COST_CACHE_TTL_MS };
    return value;
  }

  // ─── Balance ──────────────────────────────────────────────────────────────────

  async getBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return user.creditBalance;
  }

  // ─── Monthly grant (lazy, idempotent) ─────────────────────────────────────────
  //
  // Called before any usage check. Grants this month's allocation once per
  // billing month. Uses the DB to detect duplicates — safe under concurrent
  // requests because `createMany` with skipDuplicates won't double-insert.
  //
  // The grant key is `monthly_plan_grant:<userId>:<YYYY-MM>` stored in reason.
  // We check for an existing PLAN_GRANT transaction for this month rather than
  // a separate table, keeping the schema lean.

  async grantMonthlyCredits(userId: string): Promise<void> {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const reason = `monthly_plan_grant:${monthKey}`;

    // Fast path — check if already granted this month
    const existing = await this.prisma.creditTransaction.findFirst({
      where: { userId, type: CreditTxType.PLAN_GRANT, reason },
      select: { id: true },
    });
    if (existing) return;

    // Resolve this user's effective plan → credit allocation
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, trialEndsAt: true, trialTier: true },
    });

    const effectiveTier =
      user.trialEndsAt && user.trialTier && new Date(user.trialEndsAt) > now
        ? user.trialTier
        : user.plan;

    const planConfig = getPlanConfig(effectiveTier);
    const grantAmount = planConfig.limits.maxCreditsPerMonth;

    if (grantAmount <= 0) return; // no grant for this tier

    // Atomic: increment balance + insert transaction in a single DB transaction
    await this.prisma.$transaction(async (tx) => {
      // Re-check inside transaction to prevent race-condition double grant
      const doubleCheck = await tx.creditTransaction.findFirst({
        where: { userId, type: CreditTxType.PLAN_GRANT, reason },
        select: { id: true },
      });
      if (doubleCheck) return;

      const updated = await tx.user.update({
        where: { id: userId },
        data: { creditBalance: { increment: grantAmount } },
        select: { creditBalance: true },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          amount: grantAmount,
          balance: updated.creditBalance,
          type: CreditTxType.PLAN_GRANT,
          reason,
        },
      });
    });

    this.logger.log(`[credits] granted ${grantAmount} credits to ${userId} (${reason})`);
  }

  // ─── Pre-check (before running the operation) ─────────────────────────────────
  //
  // Call BEFORE the expensive operation to fail fast without wasting API quota.
  // When credits_enabled = false this is a no-op (safe rollout — same as deduct).

  async check(userId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    if (!(await this.isCreditsEnabled())) return;
    const balance = await this.getBalance(userId);
    if (balance < amount) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_CREDITS',
        balance,
        required: amount,
        message: `Insufficient credits (you have ${balance}, this action costs ${amount}). Top up your credits to continue.`,
      });
    }
  }

  // ─── Deduct ───────────────────────────────────────────────────────────────────
  //
  // Call AFTER the operation succeeds — never charge on failure.
  // Throws ForbiddenException({ code: 'INSUFFICIENT_CREDITS' }) if balance is too low.
  // When credits_enabled = false, this is a no-op (safe rollout).

  async deduct(
    userId: string,
    amount: number,
    reason: string,
    resourceType?: string,
    usageLogId?: string,
  ): Promise<void> {
    if (amount <= 0) return;
    if (!(await this.isCreditsEnabled())) return; // safety flag — no-op until flipped

    const newBalance = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { creditBalance: true },
      });

      if (user.creditBalance < amount) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_CREDITS',
          balance: user.creditBalance,
          required: amount,
          message: `Insufficient credits (you have ${user.creditBalance}, this action costs ${amount}). Top up your credits to continue.`,
        });
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { creditBalance: { decrement: amount } },
        select: { creditBalance: true },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          amount: -amount,
          balance: updated.creditBalance,
          type: CreditTxType.USAGE,
          reason,
          resourceType: resourceType ?? null,
          usageLogId: usageLogId ?? null,
        },
      });

      return updated.creditBalance;
    });

    // Push updated balance to all open sockets for this user (fire-and-forget)
    this.socketService.emitToUser(userId, 'credit:balance', { balance: newBalance });
  }

  // ─── Add credits (admin grant, purchase, refund) ──────────────────────────────

  async add(
    userId: string,
    amount: number,
    type: CreditTxType,
    reason: string,
  ): Promise<{ newBalance: number }> {
    if (amount <= 0) throw new Error(`Credit amount must be positive, got ${amount}`);

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { creditBalance: { increment: amount } },
        select: { creditBalance: true },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          amount,
          balance: updated.creditBalance,
          type,
          reason,
        },
      });

      return updated.creditBalance;
    });

    this.logger.log(`[credits] added ${amount} (${type}) to ${userId} → balance=${result}`);
    this.socketService.emitToUser(userId, 'credit:balance', { balance: result });
    return { newBalance: result };
  }

  // ─── History ──────────────────────────────────────────────────────────────────

  async getHistory(userId: string, limit = 20): Promise<CreditHistoryItem[]> {
    const rows = await this.prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        amount: true,
        balance: true,
        type: true,
        reason: true,
        resourceType: true,
        createdAt: true,
      },
    });

    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ─── Invalidate caches (for admin use after config change) ────────────────────

  invalidateCostCache(): void {
    this.costCache.clear();
    this.creditsEnabledCache = null;
  }
}
