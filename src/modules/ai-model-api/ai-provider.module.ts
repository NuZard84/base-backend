import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GeminiSummarizeProvider } from './providers/gemini.summarize-provider';
import { OpenAiSummarizeProvider } from './providers/openai.summarize-provider';
import { ClaudeSummarizeProvider } from './providers/claude.summarize-provider';
import { AiProviderFactory } from './ai-provider.factory';

/**
 * AiProviderModule
 *
 * Registers all AI summarization providers and the AiProviderFactory.
 * Import this module wherever you need multi-provider AI summarization.
 *
 * To add a new provider:
 *   1. Create src/modules/ai-model-api/providers/myprovider.summarize-provider.ts
 *   2. Add it to `providers` and `exports` arrays below
 *   3. Inject it in AiProviderFactory and register it in onModuleInit
 */
@Module({
  imports: [ConfigModule],
  providers: [
    GeminiSummarizeProvider,
    OpenAiSummarizeProvider,
    ClaudeSummarizeProvider,
    AiProviderFactory,
  ],
  exports: [AiProviderFactory],
})
export class AiProviderModule {}
