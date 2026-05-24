import {
  Injectable,
  Logger,
  UnauthorizedException,
  OnModuleInit,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from 'prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from 'src/redis/redis.service';
import { EmailService } from 'src/modules/email/email.service';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

// Constant-time bcrypt placeholder — used when the user is missing or has no
// password so login always runs the full bcrypt work and "wrong password" is
// indistinguishable from "email not found" via timing.
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TqznbMGjxHFPQ7t2TNJNJblZFIly';

const SLIDING_WINDOW_MS = (Number(process.env.EXPIRE_REFRESH_TOKEN) || 30 * 24 * 60 * 60) * 1_000;
const HARD_CAP_MS = 90 * 24 * 60 * 60 * 1_000;

const AUTH_CODE_TTL_SECONDS = 60;
const AUTH_CODE_REDIS_PREFIX = 'auth:code:';

// Fallback grace window for when the Redis successor chain isn't available
// (Redis down, chain expired, etc.). Must exceed the frontend's cross-tab stall
// timeout (REFRESH_LOCK_TTL + 1s = 16s).
const CONCURRENT_GRACE_MS = 20_000;

// Redis key prefix and TTL for the token successor chain.
// Allows stale tabs (bfcache, background, slow network) to auto-recover for up
// to TOKEN_CHAIN_TTL_SECONDS after their token was rotated — without triggering
// false "reuse detected" logouts. The chain is consumed atomically (GETDEL) so
// it can only be used once; a second attempt correctly falls through to theft detection.
const TOKEN_CHAIN_PREFIX = 'token-chain:';
const TOKEN_CHAIN_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private redisService: RedisService,
    private emailService: EmailService,
    @InjectQueue('cleanup') private cleanupQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.cleanupQueue.add(
      'cleanup-revoked-sessions',
      {},
      {
        repeat: { pattern: '0 2 * * *' },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
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
            name: profile.displayName || email.split('@')[0] || null,
            image: profile.photos?.[0]?.value || null,
            googleId: profile.id,
            emailVerified: true,
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
            emailVerified: true,
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
      return { user: this.sanitizeUser(user), accessToken, refreshToken };
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

    if (session?.isRevoked) {
      return this.handleRevokedToken(session, now);
    }

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt < now) {
      await this.prisma.session.update({ where: { id: session.id }, data: { isRevoked: true } });
      throw new UnauthorizedException('Session expired — please log in again');
    }

    if (session.absoluteExpiresAt < now) {
      await this.prisma.session.update({ where: { id: session.id }, data: { isRevoked: true } });
      throw new UnauthorizedException('Session reached maximum lifetime — please log in again');
    }

    return this.rotateSession(session, now);
  }

  // Handles a revoked token presentation. Three paths:
  // 1. Successor chain found in Redis → stale-tab auto-recovery (transparent, no logout).
  // 2. Chain consumed or successor also revoked → genuine theft → revoke all sessions.
  // 3. No chain (Redis down / TTL expired) → fall back to time-based grace window.
  private async handleRevokedToken(
    session: { id: string; userId: string; lastUsedAt: Date } & Record<string, any>,
    now: Date,
  ) {
    let successorSessionId: string | null = null;
    try {
      successorSessionId = await this.redisService.getdel(`${TOKEN_CHAIN_PREFIX}${session.id}`);
    } catch {
      // Redis unavailable — fall through to grace-period behavior
    }

    if (successorSessionId) {
      const successor = await this.prisma.session.findUnique({
        where: { id: successorSessionId },
        include: { user: true },
      });

      if (successor && !successor.isRevoked && successor.expiresAt > now && successor.absoluteExpiresAt > now) {
        this.logger.warn(`Stale-tab auto-recovery for user ${session.userId}`);
        return this.rotateSession(successor, now);
      }

      // Successor already revoked — chain was consumed by another party → theft
      this.logger.warn(`Token chain consumed for user ${session.userId} — all sessions revoked`);
      await this.prisma.session.updateMany({
        where: { userId: session.userId, isRevoked: false },
        data: { isRevoked: true },
      });
      throw new UnauthorizedException('Refresh token reuse detected — please log in again');
    }

    // No chain in Redis: fall back to time-based grace window
    const timeSinceRevocation = now.getTime() - session.lastUsedAt.getTime();
    if (timeSinceRevocation <= CONCURRENT_GRACE_MS) {
      this.logger.warn(`Concurrent refresh race for user ${session.userId} — retry`);
      throw new UnauthorizedException('Session rotated — please retry');
    }

    await this.prisma.session.updateMany({
      where: { userId: session.userId, isRevoked: false },
      data: { isRevoked: true },
    });
    this.logger.warn(`Refresh token reuse detected for user ${session.userId} — all sessions revoked`);
    throw new UnauthorizedException('Refresh token reuse detected — please log in again');
  }

  // Atomically revokes the given session, creates a new one, stores the successor
  // chain in Redis, and returns fresh tokens. The atomic updateMany (isRevoked: false
  // guard) prevents a double-rotation race where two concurrent requests both pass
  // findUnique before either revokes the session.
  private async rotateSession(
    session: { id: string; userId: string; absoluteExpiresAt: Date; user: { id: string; email: string } },
    now: Date,
  ) {
    const revoked = await this.prisma.session.updateMany({
      where: { id: session.id, isRevoked: false },
      data: { isRevoked: true, lastUsedAt: now },
    });

    if (revoked.count === 0) {
      // Lost a concurrent rotation race — ask the client to retry with the new cookie
      throw new UnauthorizedException('Session rotated — please retry');
    }

    const newRefreshToken = uuidv4();
    const slidingExpiry = new Date(now.getTime() + SLIDING_WINDOW_MS);
    const newExpiry = new Date(
      Math.min(slidingExpiry.getTime(), session.absoluteExpiresAt.getTime()),
    );

    const newSession = await this.prisma.session.create({
      data: {
        userId: session.userId,
        token: newRefreshToken,
        expiresAt: newExpiry,
        absoluteExpiresAt: session.absoluteExpiresAt,
        lastUsedAt: now,
      },
    });

    // Store successor chain so a stale tab presenting the old token can auto-recover
    // within TOKEN_CHAIN_TTL_SECONDS without triggering a false "theft" revocation.
    try {
      await this.redisService.set(
        `${TOKEN_CHAIN_PREFIX}${session.id}`,
        newSession.id,
        TOKEN_CHAIN_TTL_SECONDS,
      );
    } catch {
      // Non-critical — falls back to grace-period behavior on next revoked-token check
    }

    const newAccessToken = this.jwtService.sign(
      { sub: session.user.id, email: session.user.email },
      { expiresIn: Number(process.env.EXPIRE_ACCESS_TOKEN) },
    );

    this.logger.log(`Token rotated for user: ${session.user.id}`);
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  // ── Email / Password Auth ─────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (existing) {
      if (existing.googleId && !existing.passwordHash) {
        throw new ConflictException(
          'This email is linked to a Google account. Please sign in with Google.',
        );
      }
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const { token: verifyToken, expiry: verifyTokenExpiry } = this.generateVerifyToken();

    const configRow = await this.prisma.appConfig.findUnique({
      where: { key: 'default_trial_days' },
    });
    const trialDays = configRow ? parseInt(configRow.value, 10) : 14;

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000')
      .split(',')[0]
      .trim();

    const AVATARS = [
      'https://0mtz1m6rci3cbssu.public.blob.vercel-storage.com/avatar.png',
      'https://0mtz1m6rci3cbssu.public.blob.vercel-storage.com/avatar2.png',
      'https://0mtz1m6rci3cbssu.public.blob.vercel-storage.com/avatar3.png',
      'https://0mtz1m6rci3cbssu.public.blob.vercel-storage.com/avatar4.png',
      'https://0mtz1m6rci3cbssu.public.blob.vercel-storage.com/avatar5.png',
    ];
    const image = AVATARS[Math.floor(Math.random() * AVATARS.length)];

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name || dto.email.split('@')[0],
        passwordHash,
        image,
        emailVerified: false,
        verifyToken,
        verifyTokenExpiry,
        trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
        trialTier: 'STARTER',
      },
    });
    const verifyUrl = `${frontendUrl}/auth/verify-email?token=${verifyToken}`;

    void this.emailService.sendEmailVerification({
      toEmail: user.email,
      userName: user.name ?? user.email.split('@')[0],
      verifyUrl,
    });

    this.logger.log(`New email/password user registered: ${user.email}`);
    return { message: 'Registration successful. Check your email to verify your account.' };
  }

  async loginWithPassword(dto: LoginDto): Promise<{ code: string; user: object }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Constant-time response — run bcrypt even on miss so timing can't distinguish cases.
    if (!user) {
      try { await bcrypt.compare(dto.password, DUMMY_HASH); } catch {}
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (!user.passwordHash) {
      try { await bcrypt.compare(dto.password, DUMMY_HASH); } catch {}
      throw new UnauthorizedException(
        'This account uses Google Sign-In. Please sign in with Google instead.',
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException(
        'Please verify your email before logging in. Check your inbox for the verification link.',
      );
    }

    const safeUser = this.sanitizeUser(user);
    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email },
      { expiresIn: Number(process.env.EXPIRE_ACCESS_TOKEN) },
    );
    const refreshToken = await this.createSession(user.id);
    const code = await this.createAuthCode({ accessToken, refreshToken, user: safeUser });

    void this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.log(`Email/password login: ${user.id}`);
    return { code, user: safeUser };
  }

  async verifyEmail(token: string): Promise<{ code: string; user: object }> {
    const user = await this.prisma.user.findFirst({ where: { verifyToken: token } });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired verification link.');
    }

    if (!user.verifyTokenExpiry || user.verifyTokenExpiry < new Date()) {
      // Clear the expired token so the user must request a new one
      await this.prisma.user.update({
        where: { id: user.id },
        data: { verifyToken: null, verifyTokenExpiry: null },
      });
      throw new UnauthorizedException(
        'Verification link has expired. Please request a new one.',
      );
    }

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verifyToken: null,
        verifyTokenExpiry: null,
        lastLoginAt: new Date(),
      },
    });

    const safeUser = this.sanitizeUser(verified);

    // Auto-login after verification — no second login step required
    const accessToken = this.jwtService.sign(
      { sub: verified.id, email: verified.email },
      { expiresIn: Number(process.env.EXPIRE_ACCESS_TOKEN) },
    );
    const refreshToken = await this.createSession(verified.id);
    const code = await this.createAuthCode({ accessToken, refreshToken, user: safeUser });

    this.logger.log(`Email verified and auto-logged-in: ${verified.id}`);
    return { code, user: safeUser };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    // Generic response on every path to prevent user enumeration.
    const genericResponse = {
      message: "If that email is registered and unverified, we've sent a new verification link.",
    };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerified || !user.passwordHash) return genericResponse;

    const rateLimitKey = `verify:resend:${user.id}`;
    try {
      if (await this.redisService.get(rateLimitKey)) return genericResponse;
    } catch {}

    const { token: verifyToken, expiry: verifyTokenExpiry } = this.generateVerifyToken();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { verifyToken, verifyTokenExpiry },
    });

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000')
      .split(',')[0]
      .trim();

    void this.emailService.sendEmailVerification({
      toEmail: user.email,
      userName: user.name ?? user.email.split('@')[0],
      verifyUrl: `${frontendUrl}/auth/verify-email?token=${verifyToken}`,
    });

    try { await this.redisService.set(rateLimitKey, '1', 300); } catch {}
    this.logger.log(`Verification email resent to: ${user.email}`);
    return genericResponse;
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    // Generic response on every path to prevent user enumeration.
    const genericResponse = {
      message: "If that email is registered, we've sent a password reset link.",
    };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) return genericResponse;

    const rateLimitKey = `pwd:reset:${user.id}`;
    try {
      if (await this.redisService.get(rateLimitKey)) return genericResponse;
    } catch {}

    const { token: resetToken, expiry: resetTokenExpiry } = this.generateResetToken();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000')
      .split(',')[0]
      .trim();

    void this.emailService.sendPasswordReset({
      toEmail: user.email,
      userName: user.name ?? user.email.split('@')[0],
      resetUrl: `${frontendUrl}/auth/reset-password?token=${resetToken}`,
    });

    try { await this.redisService.set(rateLimitKey, '1', 300); } catch {}
    this.logger.log(`Password reset email sent to: ${user.email}`);
    return genericResponse;
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({ where: { resetToken: token } });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset link.');
    }

    if (!user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { resetToken: null, resetTokenExpiry: null },
      });
      throw new UnauthorizedException('Reset link has expired. Please request a new one.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiry: null },
    });

    // Password change must invalidate every existing login.
    await this.prisma.session.updateMany({
      where: { userId: user.id, isRevoked: false },
      data: { isRevoked: true },
    });

    this.logger.log(`Password reset completed for user: ${user.id}`);
    return { message: 'Password reset successful. Please sign in with your new password.' };
  }

  private generateResetToken(): { token: string; expiry: Date } {
    return {
      token: randomBytes(32).toString('hex'),
      expiry: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  private generateVerifyToken(): { token: string; expiry: Date } {
    return {
      token: randomBytes(32).toString('hex'),
      expiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  // Strip server-only fields before any user object reaches the browser.
  private sanitizeUser(user: Record<string, any>): object {
    const { passwordHash, verifyToken, verifyTokenExpiry, ...safe } = user;
    return safe;
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;
    try {
      await this.prisma.session.updateMany({
        where: { token: refreshToken, isRevoked: false },
        data: { isRevoked: true },
      });
    } catch {
      // Logout must appear to succeed even if the DB write fails.
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

  // One-time auth code exchange — keeps tokens out of URLs, history, and Referer
  // headers across the OAuth/login redirect chain.

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
    if (!raw) throw new UnauthorizedException('Invalid or expired auth code');
    return JSON.parse(raw);
  }

  async cleanupRevokedSessions() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    try {
      const deleted = await this.prisma.session.deleteMany({
        where: { isRevoked: true, createdAt: { lt: sevenDaysAgo } },
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
