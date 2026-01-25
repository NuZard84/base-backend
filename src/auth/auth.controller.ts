import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Authentication')
@Controller('api/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
  ) { }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  googleLogin() { }

  @Get('callback/google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback handler' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  googleCallback(@Req() req) {
    return req.user;
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
}

