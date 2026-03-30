import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './google/google.strategy';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { RedisModule } from 'src/redis/redis.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { CleanupProcessor } from './cleanup.processor';

@Module({
  imports: [
    PassportModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<number>('EXPIRE_ACCESS_TOKEN'),
        },
      }),
      inject: [ConfigService],
    }),
    RedisModule,
    BullModule.registerQueue({
      name: 'cleanup',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, JwtStrategy, CleanupProcessor],
})
export class AuthModule { }

