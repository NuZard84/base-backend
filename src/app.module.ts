import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // BullMQ root: shared Redis connection for all queues
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          username: config.get<string>('REDIS_USERNAME') || undefined,
        },
      }),
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
