import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NapkinService } from './napkin.service';
import { NapkinController } from './napkin.controller';
import { GeminiModule } from '../ai-model-api/gemini/gemini.module';

@Module({
    imports: [ConfigModule, GeminiModule],
    controllers: [NapkinController],
    providers: [NapkinService],
    exports: [NapkinService],
})
export class NapkinModule {}
