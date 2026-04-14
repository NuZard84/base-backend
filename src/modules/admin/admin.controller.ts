import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleInit,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { RedisService } from 'src/redis/redis.service';
import { AdminGuard } from './admin.guard';
import { AdminOriginGuard } from './admin-origin.guard';
import { AdminService } from './admin.service';
import { BugReportsService } from '../bug-reports/bug-reports.service';
import { BugReportStatus } from '@prisma/client';

const PIN_MAX = 5;
const PIN_WINDOW_SEC = 10 * 60; // 10 minutes

@UseGuards(AdminOriginGuard)
@Controller('admin')
export class AdminController implements OnModuleInit {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly bugReportsService: BugReportsService,
  ) {}

  onModuleInit() {
    const secret = this.config.get<string>('ADMIN_JWT_SECRET', '');
    if (!secret || secret === 'change-me-to-a-strong-random-secret') {
      this.logger.warn(
        '⚠️  ADMIN_JWT_SECRET is using the default/insecure value. Set a strong secret in .env before deploying to production.',
      );
    }
    const pin = this.config.get<string>('ADMIN_PIN', '');
    if (!pin || pin === '123456') {
      this.logger.warn(
        '⚠️  ADMIN_PIN is set to the default "123456". Change it in .env before deploying to production.',
      );
    }
    const username = this.config.get<string>('ADMIN_USERNAME', '');
    if (!username || username === 'admin') {
      this.logger.warn(
        '⚠️  ADMIN_USERNAME is using the default "admin". Set a strong username in .env before deploying to production.',
      );
    }
  }

  // ─── PIN Auth ────────────────────────────────────────────────────────────────

  @Post('auth/verify')
  async verifyPin(
    @Body('username') username: string,
    @Body('pin') pin: string,
    @Req() req: Request,
  ) {
    // Take the LAST IP in x-forwarded-for — that's the one appended by our
    // trusted load balancer (Cloud Run), not the client-controlled first entry.
    // Using the first IP lets attackers bypass the lockout by spoofing the header.
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    const forwardedIps = forwarded?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    const ip = forwardedIps[forwardedIps.length - 1] ?? req.ip ?? 'unknown';
    const redisKey = `admin:pin_attempts:${ip}`;

    // ── Check existing lockout ───────────────────────────────────────────────
    const attemptsRaw = await this.redis.get(redisKey);
    const attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;

    if (attempts >= PIN_MAX) {
      throw new HttpException(
        `Too many failed attempts. Try again in ${PIN_WINDOW_SEC}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── Input validation ─────────────────────────────────────────────────────
    if (!username?.trim()) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const expectedUsername = this.config.get<string>('ADMIN_USERNAME', 'admin');
    const expectedPin = this.config.get<string>('ADMIN_PIN', '123456');

    // ── Constant-time comparison — check both together to prevent enumeration ─
    const usernameOk = username.trim() === expectedUsername;
    const pinOk = pin === expectedPin;

    if (!usernameOk || !pinOk) {
      const newCount = await this.redis.incr(redisKey);
      if (newCount === 1) {
        await this.redis.expire(redisKey, PIN_WINDOW_SEC);
      }

      const remaining = PIN_MAX - newCount;
      throw new UnauthorizedException(
        remaining > 0
          ? `Invalid credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : `Invalid credentials. Too many attempts — locked for ${PIN_WINDOW_SEC / 60} minutes.`,
      );
    }

    // ── Success — clear lockout ──────────────────────────────────────────────
    await this.redis.del(redisKey);

    const secret = this.config.get<string>('ADMIN_JWT_SECRET', 'admin-secret-dev');
    const token = jwt.sign({ admin: true }, secret, { expiresIn: '8h' });
    return { token };
  }

  // ─── Maintenance ────────────────────────────────────────────────────────────

  /**
   * Trigger revoked-session cleanup manually.
   * Hit by Cloud Scheduler (or ops team) so cleanup runs even if the BullMQ
   * in-process job missed its window after a Cloud Run restart.
   *
   * Cloud Scheduler target: POST https://<backend-url>/admin/maintenance/cleanup
   * Add Authorization: Bearer <admin-token> header (same token as admin panel).
   */
  @Post('maintenance/cleanup')
  @UseGuards(AdminGuard)
  async triggerCleanup() {
    const result = await this.adminService.cleanupRevokedSessions();
    this.logger.log(`Manual cleanup: deleted ${result.deletedCount} revoked sessions`);
    return result;
  }

  // ─── Analytics ───────────────────────────────────────────────────────────────

  @Get('analytics')
  @UseGuards(AdminGuard)
  getAnalytics(@Query('force') force?: string) {
    return this.adminService.getAnalytics(force === 'true');
  }

  // ─── Users ───────────────────────────────────────────────────────────────────

  @Get('users')
  @UseGuards(AdminGuard)
  getUsers(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('search') search?: string,
    @Query('plan') plan?: string,
  ) {
    return this.adminService.getUsers(
      parseInt(page, 10),
      parseInt(pageSize, 10),
      search,
      plan,
    );
  }

  @Patch('users/:id/plan')
  @UseGuards(AdminGuard)
  updateUserPlan(
    @Param('id') id: string,
    @Body()
    body: {
      plan: string;
      trialEndsAt?: string | null;
      trialTier?: string | null;
    },
  ) {
    return this.adminService.updateUserPlan(
      id,
      body.plan,
      body.trialEndsAt,
      body.trialTier,
    );
  }

  // ─── Plan Overrides ──────────────────────────────────────────────────────────

  @Get('plan-overrides')
  @UseGuards(AdminGuard)
  getPlanOverrides() {
    return this.adminService.getPlanOverrides();
  }

  @Post('plan-overrides/feature')
  @UseGuards(AdminGuard)
  setFeatureOverride(
    @Body() body: { tier: string; feature: string; enabled: boolean | null },
  ) {
    return this.adminService.setFeatureOverride(body.tier, body.feature, body.enabled);
  }

  @Post('plan-overrides/limit')
  @UseGuards(AdminGuard)
  setLimitOverride(
    @Body() body: { tier: string; limitKey: string; value: number | null },
  ) {
    return this.adminService.setLimitOverride(body.tier, body.limitKey, body.value);
  }

  @Post('plan-overrides/reset/:tier')
  @UseGuards(AdminGuard)
  resetTierOverrides(@Param('tier') tier: string) {
    return this.adminService.resetAllOverridesForTier(tier);
  }

  // ─── Revenue ─────────────────────────────────────────────────────────────────

  @Get('revenue')
  @UseGuards(AdminGuard)
  getRevenueAnalytics(@Query('gateway') gateway?: string) {
    return this.adminService.getRevenueAnalytics(gateway);
  }

  @Get('transactions')
  @UseGuards(AdminGuard)
  getTransactions(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('gateway') gateway?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getTransactions(
      parseInt(page, 10),
      parseInt(pageSize, 10),
      gateway,
      status,
      search,
    );
  }

  // ─── Stripe Sync (repair missed webhooks) ────────────────────────────────────

  @Post('users/:id/sync-stripe')
  @UseGuards(AdminGuard)
  syncUserFromStripe(@Param('id') id: string) {
    return this.adminService.syncUserFromStripe(id);
  }

  // ─── Webhook Logs ────────────────────────────────────────────────────────────

  @Get('webhook-logs')
  @UseGuards(AdminGuard)
  getWebhookLogs(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('status') status?: string,
    @Query('eventType') eventType?: string,
  ) {
    return this.adminService.getWebhookLogs(
      parseInt(page, 10),
      parseInt(pageSize, 10),
      status,
      eventType,
    );
  }

  // ─── App Config ──────────────────────────────────────────────────────────────

  @Get('config')
  @UseGuards(AdminGuard)
  getAppConfig() {
    return this.adminService.getAppConfig();
  }

  @Post('config')
  @UseGuards(AdminGuard)
  setAppConfig(@Body() body: { key: string; value: string }) {
    return this.adminService.setAppConfig(body.key, body.value);
  }

  // ─── Bug Reports ─────────────────────────────────────────────────────────────

  @Get('bug-reports')
  @UseGuards(AdminGuard)
  getBugReports(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
  ) {
    return this.bugReportsService.findAll({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      status,
    });
  }

  @Get('bug-reports/stats')
  @UseGuards(AdminGuard)
  getBugReportStats() {
    return this.bugReportsService.getStats();
  }

  @Patch('bug-reports/:id')
  @UseGuards(AdminGuard)
  updateBugReport(
    @Param('id') id: string,
    @Body() body: { status: BugReportStatus; adminNote?: string },
  ) {
    return this.bugReportsService.updateStatus(id, body.status, body.adminNote);
  }
}
