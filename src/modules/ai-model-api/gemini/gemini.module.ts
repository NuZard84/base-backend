import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GeminiService } from './gemini.service';
import { GeminiController } from './gemini.controller';
import { S3Service } from '../../attachments/s3.service';
import { CreditModule } from 'src/common/credits/credit.module';

@Module({
    imports: [ConfigModule, CreditModule],
    controllers: [GeminiController],
    providers: [GeminiService, S3Service],
    exports: [GeminiService],
})
export class GeminiModule { }
