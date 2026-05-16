import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiImageController } from './ai-image.controller';
import { AiImageService } from './ai-image.service';
import { AiPythonClient } from './ai-python.client';
import { PlanModule } from 'src/common/plans';
import { CreditModule } from 'src/common/credits/credit.module';

@Module({
  imports: [ConfigModule, PlanModule, CreditModule],
  controllers: [AiImageController],
  providers: [AiImageService, AiPythonClient],
  exports: [AiImageService],
})
export class AiImageModule {}
