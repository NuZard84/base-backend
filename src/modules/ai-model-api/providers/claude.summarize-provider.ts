import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ISummarizeProvider,
  ParsedFileContent,
  SummarizeOptions,
  SummarizeResult,
} from './ai-provider.interface';

/**
 * Anthropic Claude summarization provider.
 *
 * To activate: install `@anthropic-ai/sdk` and set ANTHROPIC_API_KEY in .env.
 *   npm install @anthropic-ai/sdk
 *
 * Then uncomment the implementation below and remove the stub.
 */
@Injectable()
export class ClaudeSummarizeProvider implements ISummarizeProvider {
  readonly name = 'claude';
  readonly isConfigured: boolean;

  private readonly logger = new Logger(ClaudeSummarizeProvider.name);
  // private client: Anthropic | null = null;  // uncomment after installing @anthropic-ai/sdk

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.isConfigured = !!apiKey;

    if (apiKey) {
      // this.client = new Anthropic({ apiKey });  // uncomment
      this.logger.log('Anthropic API key found — provider ready (stub, not yet implemented)');
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — ClaudeSummarizeProvider is inactive');
    }
  }

  async summarize(
    content: ParsedFileContent,
    options: SummarizeOptions = {},
  ): Promise<SummarizeResult> {
    if (!this.isConfigured) {
      throw new Error('Anthropic API key is not configured. Set ANTHROPIC_API_KEY in your .env file.');
    }

    // TODO: Implement Claude summarization.
    //
    // Example implementation using claude-3-5-sonnet:
    //
    // const model = options.model ?? 'claude-sonnet-4-6';
    // const systemPrompt = `You are a document summarization assistant.
    //   Response length: ${options.responseLength ?? 'medium'}.`;
    //
    // const userContent: Anthropic.ContentBlockParam[] = [
    //   { type: 'text', text: `File: ${content.filename}\n\n${content.text ?? '[No text content]'}` },
    // ];
    //
    // For images (content.fileType === 'IMAGE' && content.buffer):
    //   userContent.unshift({
    //     type: 'image',
    //     source: { type: 'base64', media_type: content.mimeType as any, data: content.buffer.toString('base64') },
    //   });
    //
    // const response = await this.client.messages.create({
    //   model,
    //   max_tokens: 2048,
    //   system: systemPrompt,
    //   messages: [{ role: 'user', content: userContent }],
    // });
    // const summary = (response.content[0] as any)?.text ?? '';
    // return { summary, provider: this.name, model };

    throw new Error('Claude provider is not yet implemented. See claude.summarize-provider.ts for instructions.');
  }
}
