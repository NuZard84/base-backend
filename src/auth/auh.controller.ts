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

@Controller('api/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
  ) { }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  googleLogin() { }

  @Get('callback/google')
  @UseGuards(AuthGuard('google'))
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  googleCallback(@Req() req) {
    return req.user;
  }

  @Post('refresh')
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

