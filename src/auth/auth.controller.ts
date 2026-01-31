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
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { GoogleAuthGuard } from './google/google-auth.guard';

@ApiTags('Authentication')
@Controller('api/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
  ) { }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  googleLogin() { }

  @Get('callback/google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback handler' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  googleCallback(@Req() req, @Res() res) {
    const { user, accessToken, refreshToken } = req.user;

    // Redirect to frontend with tokens
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}&user=${encodeURIComponent(JSON.stringify(user))}`;

    return res.redirect(redirectUrl);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, description: 'Access token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async refresh(@Body() body: RefreshTokenDto) {
    try {
      const tokens = await this.authService.refreshAccessToken(
        body.refreshToken,
      );
      if (!tokens) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      return tokens;
    } catch (error) {
      throw new UnauthorizedException('Token refresh failed');
    }
  }

  @Post('guest')
  @ApiOperation({ summary: 'Create a guest user and return tokens' })
  @ApiResponse({ status: 201, description: 'Guest user created successfully' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createGuest() {
    return this.authService.createGuestUser();
  }
}

