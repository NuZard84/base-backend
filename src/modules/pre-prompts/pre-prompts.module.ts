import { Module } from '@nestjs/common';
import { PrePromptsController } from './pre-prompts.controller';
import { PrePromptsService } from './pre-prompts.service';

@Module({
  controllers: [PrePromptsController],
  providers: [PrePromptsService],
})
export class PrePromptsModule {}
