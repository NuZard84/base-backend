import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BriaController } from './bria.controller';
import { BriaService } from './bria.service';
import { BriaApiService } from './bria-api.service';
import { BriaPollerService } from './bria-poller.service';
import { AttachmentsModule } from '../attachments/attachments.module';

@Module({
  imports: [ConfigModule, AttachmentsModule],
  controllers: [BriaController],
  providers: [BriaApiService, BriaPollerService, BriaService],
  exports: [BriaService],
})
export class BriaModule {}
