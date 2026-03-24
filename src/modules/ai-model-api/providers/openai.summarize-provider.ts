import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ISummarizeProvider,
  ParsedFileContent,
  SummarizeOptions,
  SummarizeResult,
} from './ai-provider.interface';

/**
 * OpenAI summarization provider.
 *
 * To activate: install `openai` package and set OPENAI_API_KEY in .env.
 *   npm install openai
 *
 * Then uncomment the implementation below and remove the stub.
 */
@Injectable()
export class OpenAiSummarizeProvider implements ISummarizeProvider {
  readonly name = 'openai';
  readonly isConfigured: boolean;

  private readonly logger = new Logger(OpenAiSummarizeProvider.name);
  // private client: OpenAI | null = null;  // uncomment after installing openai

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.isConfigured = !!apiKey;

    if (apiKey) {
      // this.client = new OpenAI({ apiKey });  // uncomment
      this.logger.log('OpenAI API key found — provider ready (stub, not yet implemented)');
    } else {
      this.logger.warn('OPENAI_API_KEY not set — OpenAiSummarizeProvider is inactive');
    }
  }

  async summarize(
    content: ParsedFileContent,
    options: SummarizeOptions = {},
  ): Promise<SummarizeResult> {
    if (!this.isConfigured) {
      throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY in your .env file.');
    }

    // TODO: Implement OpenAI summarization.
    //
    // Example implementation using gpt-4o:
    //
    // const model = options.model ?? 'gpt-4o';
    // const messages: ChatCompletionMessageParam[] = [
    //   {
    //     role: 'system',
    //     content: `You are a document summarization assistant. Response length: ${options.responseLength ?? 'medium'}.`,
    //   },
    //   {
    //     role: 'user',
    //     content: `File: ${content.filename}\n\n${content.text ?? '[No text content]'}`,
    //   },
    // ];
    //
    // For images (content.fileType === 'IMAGE'):
    //   add an image_url part using base64 data URI
    //
    // const response = await this.client.chat.completions.create({ model, messages });
    // const summary = response.choices[0]?.message?.content ?? '';
    // return { summary, provider: this.name, model };

    throw new Error('OpenAI provider is not yet implemented. See openai.summarize-provider.ts for instructions.');
  }
}
