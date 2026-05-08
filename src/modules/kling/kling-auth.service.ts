import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class KlingAuthService implements OnModuleInit {
  private readonly logger = new Logger(KlingAuthService.name);
  private accessKey: string;
  private secretKey: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.accessKey = this.config.get<string>('KLING_ACCESS_KEY') ?? '';
    this.secretKey = this.config.get<string>('KLING_SECRET_KEY') ?? '';

    if (!this.accessKey || !this.secretKey) {
      this.logger.warn('KLING_ACCESS_KEY or KLING_SECRET_KEY is not set — Kling API calls will fail');
    }
  }

  /**
   * Generates a JWT per the official Kling API spec — fresh every call, never reused.
   * Payload: { iss: accessKey, exp: now+1800, nbf: now-5 }
   * nbf is set 5s in the past to absorb minor clock skew between client and Kling servers.
   */
  generateToken(): string {
    if (!this.accessKey || !this.secretKey) {
      throw new InternalServerErrorException('Kling API credentials are not configured');
    }

    const now = Math.floor(Date.now() / 1000);

    return jwt.sign(
      { iss: this.accessKey, exp: now + 1800, nbf: now - 5 },
      this.secretKey,
      { algorithm: 'HS256', noTimestamp: true },
    );
  }
}
