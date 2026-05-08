import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KlingController } from './kling.controller';
import { KlingService } from './kling.service';
import { KlingAuthService } from './kling-auth.service';
import { KlingPollerService } from './kling-poller.service';
import { AttachmentsModule } from '../attachments/attachments.module';

@Module({
  imports: [ConfigModule, AttachmentsModule],
  controllers: [KlingController],
  providers: [KlingService, KlingAuthService, KlingPollerService],
  exports: [KlingService],
})
export class KlingModule {}
