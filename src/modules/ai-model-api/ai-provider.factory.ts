import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISummarizeProvider } from './providers/ai-provider.interface';
import { GeminiSummarizeProvider } from './providers/gemini.summarize-provider';
import { OpenAiSummarizeProvider } from './providers/openai.summarize-provider';
import { ClaudeSummarizeProvider } from './providers/claude.summarize-provider';

/**
 * Central registry for AI summarization providers.
 *
 * Adding a new provider:
 *   1. Create a class implementing ISummarizeProvider (e.g., MyProvider)
 *   2. Inject it into AiProviderFactory's constructor
 *   3. Register it in onModuleInit with this.register(myProvider)
 *   That's it — it will be automatically available via getProvider('my-name').
 */
@Injectable()
export class AiProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(AiProviderFactory.name);
  private readonly registry = new Map<string, ISummarizeProvider>();

  constructor(
    private readonly configService: ConfigService,
    private readonly gemini: GeminiSummarizeProvider,
    private readonly openai: OpenAiSummarizeProvider,
    private readonly claude: ClaudeSummarizeProvider,
  ) {}

  onModuleInit() {
    this.register(this.gemini);
    this.register(this.openai);
    this.register(this.claude);

    const configured = [...this.registry.values()]
      .filter((p) => p.isConfigured)
      .map((p) => p.name);
    this.logger.log(`Registered AI providers. Configured: [${configured.join(', ')}]`);
  }

  private register(provider: ISummarizeProvider) {
    this.registry.set(provider.name, provider);
  }

  /**
   * Returns the provider by name.
   * Falls back to the default provider from config (AI_DEFAULT_PROVIDER) or 'gemini'.
   */
  getProvider(name?: string): ISummarizeProvider {
    const providerName =
      name ?? this.configService.get<string>('AI_DEFAULT_PROVIDER') ?? 'gemini';

    const provider = this.registry.get(providerName.toLowerCase());
    if (!provider) {
      const available = [...this.registry.keys()].join(', ');
      throw new Error(
        `Unknown AI provider "${providerName}". Available providers: ${available}`,
      );
    }
    if (!provider.isConfigured) {
      throw new Error(
        `AI provider "${providerName}" is not configured. Check the required API key in your .env file.`,
      );
    }
    return provider;
  }

  /** Returns all registered provider names and their configuration status */
  listProviders(): { name: string; isConfigured: boolean }[] {
    return [...this.registry.values()].map((p) => ({
      name: p.name,
      isConfigured: p.isConfigured,
    }));
  }
}
