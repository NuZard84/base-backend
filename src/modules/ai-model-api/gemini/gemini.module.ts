import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GeminiService } from './gemini.service';
import { GeminiController } from './gemini.controller';
import { S3Service } from '../../attachments/s3.service';

@Module({
    imports: [ConfigModule],
    controllers: [GeminiController],
    providers: [GeminiService, S3Service],
    exports: [GeminiService],
})
export class GeminiModule { }
