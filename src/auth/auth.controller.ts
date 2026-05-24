import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { GoogleAuthGuard } from './google/google-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { Response, Request } from 'express';

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Centralised — every Set-Cookie and clearCookie must use identical attributes
// or the browser will refuse to clear/replace the cookie.
function refreshCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };
}

function setRefreshCookie(res: Response, token: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('refreshToken', token, {
    ...refreshCookieOptions(isProduction),
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

@ApiTags('Authentication')
@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(private authService: AuthService) {}

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  googleLogin() {}

  @Get('callback/google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback handler' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const { user, accessToken, refreshToken } = req.user;

    // Validate redirect origin against FRONTEND_URL to prevent open-redirect.
    const allowedOrigins = (process.env.FRONTEND_URL || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    const stateOrigin = req.query?.state as string | undefined;
    const frontendUrl =
      stateOrigin && allowedOrigins.includes(stateOrigin)
        ? stateOrigin
        : allowedOrigins[0] || 'http://localhost:3000';

    const code = await this.authService.createAuthCode({ accessToken, refreshToken, user });

    const setSessionUrl =
      `${frontendUrl}/api/auth/set-session` +
      `?code=${encodeURIComponent(code)}` +
      `&user=${encodeURIComponent(JSON.stringify(user))}`;

    return res.redirect(setSessionUrl);
  }

  @Post('exchange-code')
  @ApiOperation({ summary: 'Exchange one-time auth code for session tokens (server-to-server)' })
  @ApiResponse({ status: 200, description: 'Tokens issued, refreshToken set as httpOnly cookie' })
  @ApiResponse({ status: 401, description: 'Invalid or expired auth code' })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async exchangeCode(
    @Body() body: { code: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body?.code) {
      throw new UnauthorizedException('Auth code is required');
    }

    const { refreshToken, user } = await this.authService.exchangeAuthCode(body.code);
    setRefreshCookie(res, refreshToken);
    // Access token deliberately omitted — the browser fetches it via /api/auth/refresh.
    return { user };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token (reads refresh token from httpOnly cookie)' })
  @ApiResponse({ status: 200, description: 'Access token refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = (req.cookies as any)?.refreshToken ?? (req.body as any)?.refreshToken;

    if (!refreshToken) {
      this.logMissingCookie(req);
      throw new UnauthorizedException('Refresh token is required');
    }

    const tokens = await this.authService.refreshAccessToken(refreshToken);
    setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke current session and clear refresh token cookie' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = (req.cookies as any)?.refreshToken;
    this.logLogoutCall(req, Boolean(refreshToken));

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('refreshToken', refreshCookieOptions(isProduction));
    return { success: true };
  }

  private logMissingCookie(req: Request) {
    const cookieNames = req.cookies ? Object.keys(req.cookies) : [];
    const rawCookieHeader = (req.headers.cookie as string | undefined) ?? '';
    this.logger.warn(
      `[refresh] Missing refreshToken cookie. ` +
        `cookieNames=[${cookieNames.join(',')}] ` +
        `rawCookieHeaderLength=${rawCookieHeader.length} ` +
        `rawCookieHeaderPreview="${rawCookieHeader.slice(0, 200)}" ` +
        `origin=${req.headers.origin ?? '-'} ` +
        `referer=${req.headers.referer ?? '-'} ` +
        `host=${req.headers.host ?? '-'} ` +
        `xForwardedHost=${req.headers['x-forwarded-host'] ?? '-'} ` +
        `userAgent="${(req.headers['user-agent'] as string | undefined)?.slice(0, 120) ?? '-'}" ` +
        `ip=${req.ip ?? '-'} ` +
        `hasBodyRefreshToken=${Boolean((req.body as any)?.refreshToken)}`,
    );
  }

  private logLogoutCall(req: Request, hadCookie: boolean) {
    this.logger.warn(
      `[logout] hadCookie=${hadCookie} ` +
        `origin=${req.headers.origin ?? '-'} ` +
        `referer=${req.headers.referer ?? '-'} ` +
        `userAgent="${(req.headers['user-agent'] as string | undefined)?.slice(0, 120) ?? '-'}" ` +
        `ip=${req.ip ?? '-'}`,
    );
  }

  // ── Email / Password Auth ─────────────────────────────────────────────────

  @Post('register')
  @ApiOperation({ summary: 'Register a new account with email and password' })
  @ApiResponse({ status: 201, description: 'Registration successful; verification email sent' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 201, description: 'Login successful; returns one-time code for session exchange' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Email not verified' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(@Body() dto: LoginDto) {
    // Returns { code, user } — frontend navigates to /api/auth/set-session?code=...
    // to exchange for an httpOnly refresh cookie (same flow as Google OAuth).
    return this.authService.loginWithPassword(dto);
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email address using token from verification email' })
  @ApiResponse({ status: 201, description: 'Email verified; returns one-time code for auto-login' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    // Returns { code, user } — frontend navigates to /api/auth/set-session?code=...
    // for auto-login after verification.
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend email verification link' })
  @ApiResponse({ status: 201, description: 'Response is always generic to prevent user enumeration' })
  @Throttle({ default: { limit: 3, ttl: 300000 } })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset link by email' })
  @ApiResponse({ status: 201, description: 'Always generic — prevents user enumeration' })
  @Throttle({ default: { limit: 3, ttl: 300000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using token from email link' })
  @ApiResponse({ status: 201, description: 'Password reset; all sessions revoked' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  // ─────────────────────────────────────────────────────────────────────────

  // Guest login removed — guest functionality is no longer supported
}
