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
import { AdminService } from './admin.service';

const PIN_MAX = 5;
const PIN_WINDOW_SEC = 10 * 60; // 10 minutes

@Controller('admin')
export class AdminController implements OnModuleInit {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
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
  }

  // ─── PIN Auth ────────────────────────────────────────────────────────────────

  @Post('auth/verify')
  async verifyPin(@Body('pin') pin: string, @Req() req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip ??
      'unknown';
    const redisKey = `admin:pin_attempts:${ip}`;

    // ── Check existing lockout ───────────────────────────────────────────────
    const attemptsRaw = await this.redis.get(redisKey);
    const attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;

    if (attempts >= PIN_MAX) {
      // TTL tells us exactly how many seconds remain on the lockout window
      // We can't call TTL directly via RedisService so we track remaining via
      // the count. The key auto-expires via Redis TTL — just block here.
      throw new HttpException(
        `Too many failed attempts. Try again in ${PIN_WINDOW_SEC}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── PIN format validation ────────────────────────────────────────────────
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw new UnauthorizedException('PIN must be exactly 6 digits.');
    }

    const expectedPin = this.config.get<string>('ADMIN_PIN', '123456');

    if (pin !== expectedPin) {
      // Increment attempt counter in Redis
      const newCount = await this.redis.incr(redisKey);
      // On first failure, set the 10-minute TTL — subsequent failures just
      // increment but keep the original window (Redis INCR preserves TTL)
      if (newCount === 1) {
        await this.redis.expire(redisKey, PIN_WINDOW_SEC);
      }

      const remaining = PIN_MAX - newCount;
      throw new UnauthorizedException(
        remaining > 0
          ? `Invalid PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : `Invalid PIN. Too many attempts — locked for ${PIN_WINDOW_SEC / 60} minutes.`,
      );
    }

    // ── Success — clear lockout ──────────────────────────────────────────────
    await this.redis.del(redisKey);

    const secret = this.config.get<string>('ADMIN_JWT_SECRET', 'admin-secret-dev');
    const token = jwt.sign({ admin: true }, secret, { expiresIn: '8h' });
    return { token };
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
}
