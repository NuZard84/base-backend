import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import {
  ISummarizeProvider,
  ParsedFileContent,
  SummarizeOptions,
  SummarizeResult,
} from './ai-provider.interface';

@Injectable()
export class GeminiSummarizeProvider implements ISummarizeProvider {
  readonly name = 'gemini';
  readonly isConfigured: boolean;

  private readonly logger = new Logger(GeminiSummarizeProvider.name);
  private genAI: GoogleGenAI | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    this.isConfigured = !!apiKey;
    if (apiKey) {
      this.genAI = new GoogleGenAI({ apiKey });
    } else {
      this.logger.warn('GEMINI_API_KEY not set — GeminiSummarizeProvider is inactive');
    }
  }

  async summarize(
    content: ParsedFileContent,
    options: SummarizeOptions = {},
  ): Promise<SummarizeResult> {
    if (!this.genAI) {
      throw new Error('Gemini API key is not configured');
    }

    const model = options.model ?? 'gemini-2.0-flash-lite';
    const length = options.responseLength ?? 'medium';
    const extra = options.customPrompt ? `\n\n${options.customPrompt}` : '';

    const systemInstruction = `You are a document summarization assistant.
Summarize the provided file content clearly and concisely.
Include key points, main topics, and any important data or figures.
Response length: ${length}.${extra}`;

    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

    if (content.fileType === 'IMAGE' && content.buffer) {
      // Multimodal: send the image bytes inline
      response = await this.genAI.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: content.mimeType,
                  data: content.buffer.toString('base64'),
                },
              },
              {
                text: `Please describe and summarize the content of this image (filename: ${content.filename}).${extra}`,
              },
            ],
          },
        ],
        config: { systemInstruction },
      });
    } else {
      const textContent = this.buildTextPrompt(content);
      response = await this.genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: textContent }] }],
        config: { systemInstruction },
      });
    }

    const summary = response.text ?? '';
    this.logger.log(`Summarized "${content.filename}" via Gemini model=${model}`);
    return { summary, provider: this.name, model };
  }

  private buildTextPrompt(content: ParsedFileContent): string {
    const header = `File: ${content.filename} (${content.fileType})`;
    const meta = content.meta ? `\nMetadata: ${JSON.stringify(content.meta)}` : '';
    const body = content.text
      ? `\n\n--- FILE CONTENT ---\n${content.text}`
      : '\n\n[No extractable text found]';
    return `${header}${meta}${body}`;
  }
}
