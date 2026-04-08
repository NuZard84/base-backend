import {
  Body,
  Controller,
  Get,
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
import type { Response, Request } from 'express';

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Centralised cookie options so every Set-Cookie and clearCookie call is
// identical — mismatched attributes are the most common cause of cookies not
// being sent or not being cleared in production.
function refreshCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    // SameSite=Lax is correct here because:
    //   • The refresh cookie is set on the *frontend* domain (via Next.js proxy).
    //   • All /api/auth/* requests go through the Next.js rewrite proxy on the
    //     same origin, so they count as same-site and will include the cookie.
    //   • SameSite=None (the previous value) was unnecessarily permissive and
    //     opened the door to cross-site request abuse.
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

    // Resolve the correct frontend to redirect to: use the origin encoded in
    // OAuth state (set by GoogleAuthGuard.getAuthenticateOptions), validated
    // against FRONTEND_URL to prevent open-redirect. Falls back to first entry.
    const allowedOrigins = (process.env.FRONTEND_URL || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    const stateOrigin = req.query?.state as string | undefined;
    const frontendUrl =
      stateOrigin && allowedOrigins.includes(stateOrigin)
        ? stateOrigin
        : allowedOrigins[0] || 'http://localhost:3000';

    // Store tokens in Redis under a short-lived one-time code.
    // The frontend's /api/auth/set-session route will exchange this code
    // server-to-server, so tokens NEVER appear in the browser URL,
    // browser history, server logs, or Referer headers.
    const code = await this.authService.createAuthCode({
      accessToken,
      refreshToken,
      user,
    });

    // Only the opaque code + non-sensitive user JSON travel in the URL.
    const setSessionUrl =
      `${frontendUrl}/api/auth/set-session` +
      `?code=${encodeURIComponent(code)}` +
      `&user=${encodeURIComponent(JSON.stringify(user))}`;

    return res.redirect(setSessionUrl);
  }

  // Called server-to-server by the Next.js /api/auth/set-session route handler.
  // Exchanges the one-time code for tokens (atomic: code is deleted on first use).
  // Returns only { user } — the refreshToken is set as an httpOnly cookie here
  // so the set-session route can forward it without ever exposing it to JavaScript.
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

    // The access token is NOT returned here — the browser will obtain it by
    // calling POST /api/auth/refresh (which reads the httpOnly cookie we just set).
    return { user };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token (reads refresh token from httpOnly cookie)' })
  @ApiResponse({ status: 200, description: 'Access token refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Read from cookie (primary) or body (fallback for non-browser clients)
    const refreshToken = (req.cookies as any)?.refreshToken ?? (req.body as any)?.refreshToken;

    if (!refreshToken) {
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

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    // Must use the same attributes that were used when setting the cookie —
    // mismatched SameSite/Secure/Path is the most common reason clearCookie fails.
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('refreshToken', refreshCookieOptions(isProduction));
    return { success: true };
  }

  // Guest login removed — guest functionality is no longer supported
}
