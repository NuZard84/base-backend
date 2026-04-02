import {
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

function setRefreshCookie(res: Response, token: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
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
  googleCallback(@Req() req: any, @Res() res: Response) {
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

    // Redirect to a Next.js API route that sets the httpOnly cookie on the
    // frontend's origin, then continues to /auth/callback
    const setSessionUrl =
      `${frontendUrl}/api/auth/set-session` +
      `?at=${encodeURIComponent(accessToken)}` +
      `&rt=${encodeURIComponent(refreshToken)}` +
      `&user=${encodeURIComponent(JSON.stringify(user))}`;

    return res.redirect(setSessionUrl);
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

    res.clearCookie('refreshToken', { path: '/' });
    return { success: true };
  }

  @Post('guest')
  @ApiOperation({ summary: 'Create a guest user and return tokens' })
  @ApiResponse({ status: 201, description: 'Guest user created' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createGuest(@Res({ passthrough: true }) res: Response) {
    const { user, accessToken, refreshToken } = await this.authService.createGuestUser();

    setRefreshCookie(res, refreshToken);

    return { user, accessToken };
  }
}
