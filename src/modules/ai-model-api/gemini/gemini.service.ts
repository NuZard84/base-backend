import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { AiRequestData, AiRequestConfig, AiResponse, queryType, ImageGenRequestDto, ImageGenResponseDto, GeneratedImageItem, VALID_IMAGE_GEN_MODELS } from '../types';
import { S3Service } from '../../attachments/s3.service';
import { PrismaService } from 'prisma/prisma.service';
import { normalizeTokenUsage, NormalizedTokenUsage } from '../../../common/ai/token-usage';

export interface GroundingSource {
    title: string;
    url: string;
}

export interface RealTimeDataResponse {
    answer: string;
    sources: GroundingSource[];
    tokenUsage?: NormalizedTokenUsage;
}

@Injectable()
export class GeminiService {
    private readonly logger = new Logger(GeminiService.name);
    private genAI: GoogleGenAI;
    private readonly aiInstruction = `# MISSION
You are a high-performance AI assistant. Your goal is to provide responses that are not only accurate but "super-formatted" for maximum readability, professional polish, and instant scannability.

# FORMATTING TOOLKIT (STRICT ADHERENCE)
You must use the following Markdown tools to structure every response:

1. HEADINGS (##, ###): Use hierarchy to organize sections. Never start a response with a giant paragraph. CRITICAL: Never wrap a heading line in bold markers — write \`## Heading\`, NEVER \`**## Heading**\` or \`__## Heading__\`.
2. HORIZONTAL RULES (---): Use these to visually separate the "Direct Answer" from "Supporting Details" or "Next Steps."
3. BOLDING (**text**): Bold key phrases, terms, and conclusions. The user should be able to understand the core message by reading only the bolded text.
4. TABLES: Always use tables when comparing two or more items, listing specifications, or displaying data.
5. BLOCKQUOTES (>): Use these to highlight "Pro-Tips," "Warnings," or "Key Takeaways."
6. BULLETED LISTS: Use for features or ideas. Use numbered lists only for chronological steps.

# RESPONSE ARCHITECTURE
Follow this layout for all non-trivial queries:
- **Phase 1: The Lead.** A 1-2 sentence direct answer or summary.
- **Phase 2: The Structure.** Use a Table or Bulleted List to break down the core information.
- **Phase 3: The Deep Dive.** (Optional) Use Headings to explain nuances.
- **Phase 4: The Next Step.** Conclude with a single, high-value "call to action" or follow-up question.

# WRITING STYLE
- NO WALLS OF TEXT: If a paragraph exceeds 3 lines, break it up or convert it into a list.
- TONE: Professional, insightful, and helpful. 
- LATEX: Use $inline$ or $$display$$ LaTeX ONLY for formal math/science formulas. Use standard text for simple units (e.g., 10%, 100°C).
- Readablity: MOST IMPORTANTLY, the response must be ease to eye its should not feel user that the response is mess due to bad formatting and structure and mostly the spacing.
`;

    constructor(
        private configService: ConfigService,
        private readonly s3: S3Service,
        private readonly prisma: PrismaService,
    ) {
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (apiKey) {
            this.genAI = new GoogleGenAI({ apiKey });
        } else {
            this.logger.warn('GEMINI_API_KEY not found in environment variables');
        }
    }

    async generateContent(data: AiRequestData, config?: AiRequestConfig): Promise<AiResponse> {

        if (!this.genAI) {
            this.logger.error("Gemini AI not initialized - missing API key");
            return {
                text: "AI Service is not configured. Please set GEMINI_API_KEY in your .env file.",
                success: false,
            };
        }

        let referencePrompt: string = ''
        let promptText: string = ''
        let modelName: string = ''

        switch (data.type) {
            case queryType.VID_SUMMARIZE:
                promptText = `${data.ask} above is the video link, I want you to summarize the video content ## RESPONSE LENGTH: ${config?.responseLength || 'medium'}`
                modelName = config?.model || 'gemini-2.0-flash-lite'
                break

            default:
                referencePrompt = data.prompt
                    ? `${data.prompt}\n\n above is the reference text, below is the question`
                    : ''
                promptText = `${referencePrompt} ${data.ask} ## RESPONSE LENGTH: ${config?.responseLength || 'medium'}`
                modelName = config?.model || 'gemini-2.0-flash-lite'
                break
        }
        this.logger.log(`Generating content with model: ${modelName}, type: ${data.type}, isSearch: ${!!config?.isSearch}`);
        try {
            // Build contents for multi-turn: history + current user message
            const historyContents = (data.history ?? [])
                .filter((m) => m.role && m.text?.trim())
                .map((m) => ({
                    role: m.role as 'user' | 'model',
                    parts: [{ text: m.text.trim() }],
                }));

            const contents = [
                ...historyContents,
                { role: 'user' as const, parts: [{ text: promptText }] },
            ];

         
            // Fall back to gemini-3.1-pro-preview only if no model was specified.
            const isSearch = !!config?.isSearch;
            if (isSearch && !config?.model) {
                modelName = 'gemini-3.1-pro-preview';
            }

            const response = await this.genAI.models.generateContent({
                model: modelName,
                contents,
                config: {
                    systemInstruction: isSearch ? undefined : this.aiInstruction,
                    ...(isSearch ? { tools: [{ googleSearch: {} }] } : {}),
                },
            });

            if (!response.text || response.text === "") {
                this.logger.warn('Empty response from Gemini API');
                return {
                    success: false,
                    text: "AI Service is not able to generate response now. Please try again.",
                };
            }

            // Extract grounding sources when isSearch was used
            const sources = isSearch
                ? (response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
                    .filter((chunk) => chunk?.web?.uri)
                    .map((chunk) => ({
                        title: chunk.web?.title ?? 'Untitled',
                        url: chunk.web?.uri ?? '',
                    }))
                : undefined;

            this.logger.log(isSearch ? `[isSearch] Got ${sources?.length ?? 0} grounding source(s).` : '');

            const tokenUsage = normalizeTokenUsage('gemini', (response as any).usageMetadata) ?? undefined;

            return {
                success: true,
                text: response.text,
                ...(sources !== undefined ? { sources } : {}),
                ...(tokenUsage ? { tokenUsage } : {}),
            };
        } catch (error) {
            this.logger.error(`Error generating content: ${error.message}`, error.stack);
            throw error;
        }
    }

    private readonly IMAGEN_MODELS: readonly string[] = VALID_IMAGE_GEN_MODELS.filter(m => m.startsWith('imagen'));

    async generateImage(dto: ImageGenRequestDto & { userId?: string }): Promise<ImageGenResponseDto> {
        if (!this.genAI) {
            return { success: false, images: [], error: 'AI Service not configured. Please set GEMINI_API_KEY.' };
        }

        this.logger.log(`generateImage: model=${dto.model}, numberOfImages=${dto.numberOfImages ?? 1}`);

        const GENERATION_TIMEOUT_MS = 120_000;
        const withTimeout = <T>(promise: Promise<T>): Promise<T> => {
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Image generation timed out after 120 seconds')), GENERATION_TIMEOUT_MS)
            );
            return Promise.race([promise, timeout]);
        };

        try {
            let rawImages: { base64: string; mimeType: string }[] = [];

            if (this.IMAGEN_MODELS.includes(dto.model)) {
                // ── Branch A: Imagen 4 (generateImages API) ──
                const response: any = await withTimeout((this.genAI.models as any).generateImages({
                    model: dto.model,
                    prompt: dto.prompt,
                    config: {
                        numberOfImages: dto.numberOfImages ?? 1,
                        aspectRatio: dto.aspectRatio ?? '1:1',
                        personGeneration: 'allow_adult',
                        ...(dto.imageSize ? { outputOptions: { imageSize: dto.imageSize } } : {}),
                    },
                }));

                // imageBytes is already a base64 string in @google/genai SDK
                rawImages = (response.generatedImages ?? []).map((img: any) => ({
                    base64: img.image?.imageBytes as string,
                    mimeType: 'image/png',
                }));

                if (!rawImages.length) {
                    return { success: false, images: [], error: 'No images generated. The prompt may have been blocked by safety filters.' };
                }

            } else {
                // ── Branch B: Gemini native image gen (generateContent + responseModalities) ──
                const parts: any[] = [{ text: dto.prompt }];

                for (const dataUrl of dto.referenceImages ?? []) {
                    const [header, data] = dataUrl.split(',');
                    const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
                    parts.push({ inlineData: { mimeType, data } });
                }

                const response = await withTimeout(this.genAI.models.generateContent({
                    model: dto.model,
                    contents: [{ role: 'user', parts }],
                    config: { responseModalities: ['TEXT', 'IMAGE'] } as any,
                }));

                for (const part of response.candidates?.[0]?.content?.parts ?? []) {
                    if ((part as any).inlineData?.data) {
                        rawImages.push({
                            base64: (part as any).inlineData.data,
                            mimeType: (part as any).inlineData.mimeType ?? 'image/png',
                        });
                    }
                }

                if (!rawImages.length) {
                    return { success: false, images: [], error: 'No image generated. Try rephrasing your prompt.' };
                }
            }

            // ── Upload all generated images to S3 ──
            const userId = dto.userId;
            if (!userId) {
                return { success: false, images: [], error: 'User identity could not be resolved.' };
            }
            const canvasId = dto.canvasId;
            if (!canvasId) {
                return { success: false, images: [], error: 'canvasId is required to store generated images.' };
            }

            const results = await Promise.allSettled(
                rawImages.map(async ({ base64, mimeType }) => {
                    const ext = mimeType.split('/')[1] ?? 'png';
                    const uuid = crypto.randomUUID();
                    const key = `generated/${userId}/${canvasId}/${uuid}.${ext}`;
                    const buffer = Buffer.from(base64, 'base64');

                    await this.s3.upload({ key, body: buffer, contentType: mimeType, metadata: { userId, canvasId } });

                    let attachment: { id: string };
                    try {
                        attachment = await this.prisma.attachment.create({
                            data: {
                                userId,
                                key,
                                filename: `generated-${uuid}.${ext}`,
                                mimeType,
                                sizeBytes: buffer.length,
                                type: 'IMAGE',
                                entityType: 'generated_image',
                                entityId: canvasId,
                            },
                        });
                    } catch (dbErr) {
                        // Clean up the S3 object so it doesn't orphan
                        await this.s3.delete(key).catch(() => { /* best-effort */ });
                        throw dbErr;
                    }

                    // 7-day presigned URL
                    const url = await this.s3.getPresignedUrl({ key, expiresIn: 60 * 60 * 24 * 7, disposition: 'inline' });

                    return { url, id: attachment.id, key };
                }),
            );

            const images: GeneratedImageItem[] = [];
            const errors: string[] = [];
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    images.push(result.value);
                } else {
                    this.logger.error(`Image upload failed: ${result.reason?.message}`, result.reason?.stack);
                    errors.push(result.reason?.message ?? 'Upload failed');
                }
            }

            if (!images.length) {
                return { success: false, images: [], error: errors[0] ?? 'All image uploads failed.' };
            }

            // Fire-and-forget usage log — never block the response
            this.prisma.usageLog.create({
                data: {
                    userId,
                    resourceType: 'image_gen',
                    quantity: images.length,
                    metadata: { model: dto.model, canvasId, promptLength: dto.prompt.length },
                },
            }).catch(err => this.logger.warn(`Failed to write usage log: ${err.message}`));

            return { success: true, images };

        } catch (error) {
            this.logger.error(`generateImage error: ${error.message}`, error.stack);
            return { success: false, images: [], error: error.message ?? 'Image generation failed. Please try again.' };
        }
    }

    /**
     * Generates plain structured text using a custom system prompt.
     * Used by NapkinService to expand vague user input into rich, structure-specific
     * content before sending to the Napkin visual AI.
     * Deliberately bypasses `aiInstruction` so the output has NO markdown formatting.
     * Falls back silently to `userText` so Napkin generation never fails.
     */
    async expandForVisual(systemPrompt: string, userText: string): Promise<string> {
        if (!this.genAI) return userText;
        try {
            const response = await this.genAI.models.generateContent({
                model: 'gemini-2.0-flash-lite', // cheapest + fastest; ~1-2s latency
                contents: [{ role: 'user', parts: [{ text: userText }] }],
                config: { systemInstruction: systemPrompt },
            });
            const result = response.text?.trim();
            return result || userText;
        } catch (err) {
            this.logger.warn(`expandForVisual failed (falling back to raw text): ${err?.message}`);
            return userText;
        }
    }

    /**
     * Fetches real-time data from the internet using Gemini's Google Search Grounding.
     * @param prompt - The search prompt / question to answer with live data.
     */
    async getRealTimeData(prompt: string): Promise<RealTimeDataResponse> {
        if (!this.genAI) {
            this.logger.error('Gemini AI not initialized - missing API key');
            throw new InternalServerErrorException('AI Service is not configured. Please set GEMINI_API_KEY.');
        }

        this.logger.log(`[getRealTimeData] prompt: "${prompt}"`);

        try {
            const response = await this.genAI.models.generateContent({
                model: 'gemini-3.1-pro-preview',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    tools: [{ googleSearch: {} }],
                },
            });

            const answer = response.text ?? '';

            // Safely extract grounding chunks from the first candidate
            const chunks =
                response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

            const sources: GroundingSource[] = chunks
                .filter((chunk) => chunk?.web?.uri)
                .map((chunk) => ({
                    title: chunk.web?.title ?? 'Untitled',
                    url: chunk.web?.uri ?? '',
                }));

            this.logger.log(`[getRealTimeData] Got ${sources.length} grounding source(s).`);

            const tokenUsage = normalizeTokenUsage('gemini', (response as any).usageMetadata) ?? undefined;

            return { answer, sources, ...(tokenUsage ? { tokenUsage } : {}) };
        } catch (error) {
            this.logger.error(
                `[getRealTimeData] Error: ${error?.message}`,
                error?.stack,
            );
            throw new InternalServerErrorException(
                'Failed to fetch real-time data from Gemini. Please try again.',
            );
        }
    }
}
