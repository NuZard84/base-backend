import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

export interface ImageResult {
  text: string;
  ocrConfidence: number;
}

@Injectable()
export class ImageProcessorHelper {
  private readonly logger = new Logger(ImageProcessorHelper.name);
  private genAI: GoogleGenAI | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenAI({ apiKey, vertexai: true });
    } else {
      this.logger.warn('GEMINI_API_KEY missing — image text extraction will be unavailable');
    }
  }

  async extract(buffer: Buffer, mimeType: string, filename: string): Promise<ImageResult> {
    if (!this.genAI) {
      throw new Error('Gemini API key not configured for image text extraction');
    }

    this.logger.log(`Extracting text from image: ${filename} (${mimeType})`);

    const response = await this.genAI.models.generateContent({
      model: 'gemini-2.0-flash-lite',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: buffer.toString('base64'),
              },
            },
            {
              text: `Extract ALL text visible in this image verbatim.
If the image contains no text (or very little), provide a thorough description of the image content:
include all visible objects, people, settings, charts, diagrams, colours, labels, and any notable details.
Output only the extracted text or description — no commentary.`,
            },
          ],
        },
      ],
    });

    const text = response.text ?? '';
    // Rough confidence score based on response length vs image size
    const ocrConfidence = text.length > 50 ? 0.9 : 0.5;

    return { text, ocrConfidence };
  }
}
