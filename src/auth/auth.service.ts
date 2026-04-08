import { Injectable, Logger, UnauthorizedException, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from 'prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from 'src/redis/redis.service';
import { v4 as uuidv4 } from 'uuid';

const SLIDING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const HARD_CAP_MS = 90 * 24 * 60 * 60 * 1000;       // 90 days

// One-time auth codes TTL: 60 seconds is generous enough for slow connections
// but short enough that a leaked URL is useless after the user completes login.
const AUTH_CODE_TTL_SECONDS = 60;
const AUTH_CODE_REDIS_PREFIX = 'auth:code:';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private redisService: RedisService,
    @InjectQueue('cleanup') private cleanupQueue: Queue,
  ) {}

  async onModuleInit() {
    // Schedule cleanup job to run daily at 2 AM
    await this.cleanupQueue.add(
      'cleanup-revoked-sessions',
      {},
      {
        repeat: {
          pattern: '0 2 * * *', // Daily at 2 AM
        },
        removeOnComplete: {
          age: 3600, // Keep completed job for 1 hour
        },
        removeOnFail: {
          age: 86400, // Keep failed job for 1 day (for debugging)
        },
      },
    );
    this.logger.log('Scheduled cleanup job: Daily at 2 AM');
  }

  async validateGoogleUser(profile: any) {
    try {
      if (!profile.emails?.[0]?.value) {
        throw new UnauthorizedException('Invalid Google profile: missing email');
      }

      const email = profile.emails[0].value;
      let user = await this.prisma.user.findUnique({ where: { email } });

      if (!user) {
        const configRow = await this.prisma.appConfig.findUnique({
          where: { key: 'default_trial_days' },
        });
        const trialDays = configRow ? parseInt(configRow.value, 10) : 14;

        user = await this.prisma.user.create({
          data: {
            email,
            // Prefer Google displayName; fall back to email prefix so name is
            // never null for new users (avoids "Unknown" in peer collaboration).
            name: profile.displayName || email.split('@')[0] || null,
            image: profile.photos?.[0]?.value || null,
            googleId: profile.id,
            lastLoginAt: new Date(),
            trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
            trialTier: 'STARTER',
          },
        });
        this.logger.log(`New user created with ${trialDays}-day Free Starter trial: ${email}`);
      } else {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            image: profile.photos?.[0]?.value || user.image,
          },
        });
      }

      const accessToken = this.jwtService.sign(
        { sub: user.id, email: user.email },
        { expiresIn: Number(process.env.EXPIRE_ACCESS_TOKEN) },
      );

      const refreshToken = await this.createSession(user.id);

      this.logger.log(`User authenticated: ${user.id}`);
      return { user, accessToken, refreshToken };
    } catch (error) {
      this.logger.error('Error validating Google user:', error);
      throw error;
    }
  }

  async refreshAccessToken(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const session = await this.prisma.session.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    const now = new Date();

    // Reuse detection: token exists in DB but already revoked.
    //
    // Two scenarios produce this state:
    //   A) Genuine token theft — the attacker reused a stolen token after the
    //      legitimate user already rotated it. Revoke everything immediately.
    //   B) Cross-tab race condition — two browser tabs simultaneously detected
    //      an expired token and both called /refresh. The first tab succeeded
    //      and rotated the token; the second tab's request arrives milliseconds
    //      later carrying the now-revoked token. This is NOT theft.
    //
    // We distinguish them by checking how recently this session was revoked.
    // During rotation we stamp lastUsedAt = now on the revoked row (see below).
    // If the stamp is within the grace window it is almost certainly a race;
    // we return a plain 401 so the frontend retries with the new cookie that
    // the winning tab already set. Beyond the grace window it is treated as
    // theft and all sessions for the user are revoked.
    const CONCURRENT_GRACE_MS = 10_000; // 10 seconds
    if (session?.isRevoked) {
      const timeSinceRevocation = now.getTime() - session.lastUsedAt.getTime();
      if (timeSinceRevocation <= CONCURRENT_GRACE_MS) {
        this.logger.warn(
          `Concurrent refresh race detected for user ${session.userId} — returning 401 for retry`,
        );
        throw new UnauthorizedException('Session rotated — please retry');
      }
      await this.prisma.session.updateMany({
        where: { userId: session.userId, isRevoked: false },
        data: { isRevoked: true },
      });
      this.logger.warn(
        `Refresh token reuse detected for user ${session.userId} — all sessions revoked`,
      );
      throw new UnauthorizedException('Refresh token reuse detected — please log in again');
    }

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt < now) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { isRevoked: true },
      });
      throw new UnauthorizedException('Session expired — please log in again');
    }

    if (session.absoluteExpiresAt < now) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { isRevoked: true },
      });
      throw new UnauthorizedException('Session reached maximum lifetime — please log in again');
    }

    // Rotate: revoke old session, create new one.
    // Stamp lastUsedAt = now so the concurrent-refresh grace-period check above
    // can tell how recently this session was revoked (distinguishing a race from theft).
    await this.prisma.session.update({
      where: { id: session.id },
      data: { isRevoked: true, lastUsedAt: now },
    });

    const newRefreshToken = uuidv4();
    const slidingExpiry = new Date(now.getTime() + SLIDING_WINDOW_MS);
    // Sliding window capped at absolute max
    const newExpiry = new Date(
      Math.min(slidingExpiry.getTime(), session.absoluteExpiresAt.getTime()),
    );

    await this.prisma.session.create({
      data: {
        userId: session.userId,
        token: newRefreshToken,
        expiresAt: newExpiry,
        absoluteExpiresAt: session.absoluteExpiresAt,
        lastUsedAt: now,
      },
    });

    const newAccessToken = this.jwtService.sign(
      { sub: session.user.id, email: session.user.email },
      { expiresIn: Number(process.env.EXPIRE_ACCESS_TOKEN) },
    );

    this.logger.log(`Token rotated for user: ${session.user.id}`);
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;
    try {
      await this.prisma.session.updateMany({
        where: { token: refreshToken, isRevoked: false },
        data: { isRevoked: true },
      });
    } catch {
      // Silent fail — logout should always succeed from the user's perspective
    }
  }

  async createGuestUser() {
    try {
      const uniqueId = uuidv4();
      const email = `guest_${uniqueId}@pixelpioneers.ai`;

      const user = await this.prisma.user.create({
        data: {
          email,
          image: null,
          googleId: null,
          name: 'Guest User',
          plan: 'FREE',
        },
      });

      const accessToken = this.jwtService.sign(
        { sub: user.id, email: user.email },
        { expiresIn: Number(process.env.EXPIRE_ACCESS_TOKEN) },
      );

      const refreshToken = await this.createSession(user.id);

      this.logger.log(`Guest user created: ${email}`);
      return { user, accessToken, refreshToken };
    } catch (error) {
      this.logger.error('Error creating guest user:', error);
      throw error;
    }
  }

  private async createSession(userId: string): Promise<string> {
    const token = uuidv4();
    const now = new Date();

    await this.prisma.session.create({
      data: {
        userId,
        token,
        expiresAt: new Date(now.getTime() + SLIDING_WINDOW_MS),
        absoluteExpiresAt: new Date(now.getTime() + HARD_CAP_MS),
      },
    });

    return token;
  }

  // ── One-time auth code exchange ───────────────────────────────────────────
  // After OAuth completes, the tokens are NOT passed through the browser URL.
  // Instead the callback stores them in Redis under a short-lived opaque code
  // and the Next.js set-session route exchanges the code server-to-server.
  // This prevents tokens from ever appearing in browser history, server logs,
  // or Referer headers.

  async createAuthCode(payload: {
    accessToken: string;
    refreshToken: string;
    user: object;
  }): Promise<string> {
    const code = uuidv4();
    await this.redisService.set(
      `${AUTH_CODE_REDIS_PREFIX}${code}`,
      JSON.stringify(payload),
      AUTH_CODE_TTL_SECONDS,
    );
    return code;
  }

  async exchangeAuthCode(
    code: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: object }> {
    const raw = await this.redisService.getdel(`${AUTH_CODE_REDIS_PREFIX}${code}`);
    if (!raw) {
      // Code not found — expired, already used, or forged
      throw new UnauthorizedException('Invalid or expired auth code');
    }
    return JSON.parse(raw);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Called by BullMQ processor daily at 2 AM
  async cleanupRevokedSessions() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    try {
      const deleted = await this.prisma.session.deleteMany({
        where: {
          isRevoked: true,
          createdAt: {
            lt: sevenDaysAgo,
          },
        },
      });

      this.logger.log(
        `Cleanup completed: Deleted ${deleted.count} revoked sessions older than 7 days`,
      );
      return { success: true, deletedCount: deleted.count };
    } catch (error) {
      this.logger.error('Error during revoked sessions cleanup:', error);
      throw error;
    }
  }
}
