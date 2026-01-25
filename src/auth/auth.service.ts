// src/auth/auth.service.ts
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) { }

  async validateGoogleUser(profile: any) {
    try {
      if (!profile.emails || !profile.emails[0] || !profile.emails[0].value) {
        throw new UnauthorizedException(
          'Invalid Google profile: missing email',
        );
      }

      const email = profile.emails[0].value;

      let user = await this.prisma.user.findUnique({ where: { email } });

      if (!user) {
        user = await this.prisma.user.create({
          data: {
            email,
            name: profile.displayName || null,
            image: profile.photos?.[0]?.value || null,
            googleId: profile.id,
            lastLoginAt: new Date(),
          },
        });
        this.logger.log(`New user created: ${email}`);
      } else {
        // Update last login and potentially refresh profile picture
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            image: profile.photos?.[0]?.value || user.image,
          },
        });
      }

      const payload = {
        sub: user.id,
        email: user.email,
      };

      const accessToken = this.jwtService.sign(payload, {
        expiresIn: Number(process.env.EXPIRE_ACCESS_TOKEN),
      });
      const refreshToken = this.jwtService.sign(payload, {
        expiresIn: Number(process.env.EXPIRE_REFRESH_TOKEN),
      });

      // Store refresh token in database for security
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshToken },
      });

      return { user, accessToken, refreshToken };
    } catch (error) {
      this.logger.error('Error validating Google user:', error);
      throw error;
    }
  }

  async refreshAccessToken(refreshToken: string) {
    try {
      if (!refreshToken) {
        throw new UnauthorizedException('Refresh token is required');
      }

      const payload = this.jwtService.verify(refreshToken);

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || user.refreshToken !== refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newAccessToken = this.jwtService.sign(
        { sub: user.id, email: user.email },
        { expiresIn: Number(process.env.EXPIRE_ACCESS_TOKEN) },
      );

      this.logger.log(`Access token refreshed for user: ${user.email}`);
      return { accessToken: newAccessToken };
    } catch (error) {
      this.logger.error('Error refreshing access token:', error);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token refresh failed');
    }
  }
}
