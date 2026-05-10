import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiImageController } from './ai-image.controller';
import { AiImageService } from './ai-image.service';
import { AiPythonClient } from './ai-python.client';

@Module({
  imports: [ConfigModule],
  controllers: [AiImageController],
  providers: [AiImageService, AiPythonClient],
  exports: [AiImageService],
})
export class AiImageModule {}
