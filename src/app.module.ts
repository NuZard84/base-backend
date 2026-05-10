import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import type IORedis from 'ioredis';
import {
  BullConnectionModule,
  BULL_REDIS_CONNECTION,
} from './redis/bull-connection.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { HealthModule } from './health/health.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { GeminiModule } from './modules/ai-model-api/gemini/gemini.module';
import { CanvasesModule } from './modules/canvases/canvases.module';
import { PrePromptsModule } from './modules/pre-prompts/pre-prompts.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PlanModule } from './common/plans/plan.module';
import { AdminModule } from './modules/admin/admin.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { BugReportsModule } from './modules/bug-reports/bug-reports.module';
import { NapkinModule } from './modules/napkin/napkin.module';
import { KlingModule } from './modules/kling/kling.module';
import { BriaModule } from './modules/bria/bria.module';
import { AiImageModule } from './modules/ai-image/ai-image.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Shared IORedis instance with BullMQ-required options (maxRetriesPerRequest: null).
    // Must be listed before BullModule so the token is available for injection.
    BullConnectionModule,
    // BullMQ root: all queues share the single connection from BullConnectionModule,
    // reducing BullMQ connections from 12 (4 queues × 3) down to 1 shared + 4 blocking.
    BullModule.forRootAsync({
      imports: [BullConnectionModule],
      inject: [BULL_REDIS_CONNECTION],
      useFactory: (connection: IORedis) => ({ connection }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    PlanModule,
    AuthModule,
    UserModule,
    HealthModule,
    GeminiModule,
    CanvasesModule,
    PrePromptsModule,
    AttachmentsModule,
    DocumentsModule,
    AdminModule,
    StripeModule,
    BugReportsModule,
    NapkinModule,
    KlingModule,
    BriaModule,
    AiImageModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }
