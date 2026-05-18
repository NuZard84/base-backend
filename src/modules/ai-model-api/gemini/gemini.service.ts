import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { AiRequestData, AiRequestConfig, AiResponse, queryType, ImageGenRequestDto, ImageGenResponseDto, GeneratedImageItem, VALID_IMAGE_GEN_MODELS, VariantsRequestDto, VariantsResponseDto, ImageAnalysis, VariantItem, VariantPurpose } from '../types';
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
            this.genAI = new GoogleGenAI({ apiKey, vertexai: true });
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
                        ...(dto.negativePrompt ? { negativePrompt: dto.negativePrompt } : {}),
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

                // Fetch URLs server-side to avoid browser CORS restrictions
                for (const url of dto.referenceImageUrls ?? []) {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`Failed to fetch reference image: ${res.status}`);
                    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
                    const mimeType = contentType.split(';')[0].trim();
                    const buffer = Buffer.from(await res.arrayBuffer());
                    parts.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
                }

                const response = await withTimeout(this.genAI.models.generateContent({
                    model: dto.model,
                    contents: [{ role: 'user', parts }],
                    config: {
                        responseModalities: ['TEXT', 'IMAGE'],
                        ...(dto.aspectRatio ? { imageConfig: { aspectRatio: dto.aspectRatio } } : {}),
                    } as any,
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

    // ── Variants ────────────────────────────────────────────────────────────────

    private parseJsonSafely<T>(raw: string, label: string): T {
        const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        try {
            return JSON.parse(cleaned) as T;
        } catch {
            throw new Error(`${label}: AI returned invalid JSON — please try again`);
        }
    }

    private async analyzeImageForVariants(imageUrl: string): Promise<ImageAnalysis> {
        const fetchTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Image fetch timed out')), 15_000)
        );
        const fetchRes = await Promise.race([fetch(imageUrl), fetchTimeout]) as Response;
        if (!fetchRes.ok) throw new Error(`Failed to fetch source image: ${fetchRes.status}`);
        const mimeType = (fetchRes.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
        const base64 = Buffer.from(await fetchRes.arrayBuffer()).toString('base64');

        const analysisTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Image analysis timed out')), 30_000)
        );
        const response = await Promise.race([
            this.genAI.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType, data: base64 } },
                        {
                            text: `You are a senior creative director and photography analyst. Analyze this image with the technical precision required to brief a world-class photographer on recreating and creatively extending it.

Return EXACTLY this JSON — valid JSON only, no markdown, no code blocks, no preamble:
{
  "mood_vibe": "...",
  "product_presentation": "...",
  "lighting": "...",
  "context": "...",
  "technical_style": "...",
  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4"]
}

Field specifications:

mood_vibe — 2 sentences: the emotional register and psychological atmosphere. What feeling does this evoke? Warm/cold, urgent/calm, luxurious/raw, intimate/grand. Describe the sensory experience a viewer has.

product_presentation — precise technical description: subject angle (frontal/3-quarter/profile/overhead/low-angle), distance (macro/close-up/medium/wide), depth of field treatment (tack-sharp throughout/selective bokeh/heavy bokeh), composition principle (centered/rule-of-thirds/negative space dominant/symmetrical), what the frame deliberately excludes from view.

lighting — type (natural daylight/continuous studio/strobe/mixed), direction (frontal/45-degree/side/backlit/overhead), quality (hard-edged/soft-diffused/wrapped/bounced), color temperature (warm tungsten/neutral daylight/cool blue), any signature effects (rim light/deep shadow pools/specular highlights/glowing diffusion).

context — setting category (clean studio/lifestyle environment/outdoor location/abstract), brand register (luxury/premium-accessible/artisan/editorial/commercial), narrative intent (pure product showcase/aspirational lifestyle/documentary/artistic).

technical_style — camera and rendering character: film vs digital feel, grain or noise presence (none/subtle/prominent), color grading style (clean neutral/matte lifted/high-contrast cinematic/desaturated editorial/richly saturated), sharpness signature, post-processing fingerprint.

color_palette — 3-5 dominant hex codes ordered by visual dominance. These become strict color anchors in generation — be precise.`,
                        },
                    ],
                }],
            }),
            analysisTimeout,
        ]);

        return this.parseJsonSafely<ImageAnalysis>((response as any).text ?? '', 'Image analysis');
    }

    private readonly PURPOSE_CONTEXT: Record<string, { brief: string; v1: string; v2: string; v3: string }> = {
        marketing: {
            brief: 'MARKETING — high-impact commercial imagery engineered to stop a scroll and drive action. Hero shots, bold value-proposition staging, aspirational energy.',
            v1: 'MOOD: Shift to confident, aspirational energy — the image should feel premium and purchase-driving. Think luxury brand campaign meets high-street appeal.',
            v2: 'CAMERA: Hero shot — slightly low angle (empowering), tight product framing, razor-sharp focus, shallow depth of field that draws the eye immediately to the product.',
            v3: 'WORLD: Place the product in an aspirational lifestyle context — modern interior, urban lifestyle setting, or clean white-label studio that reads instantly as commercial hero.',
        },
        social: {
            brief: 'SOCIAL MEDIA — thumb-stopping content native to Instagram, TikTok, and Pinterest. Vibrant, bold cropping, high visual energy optimized for small-screen impact.',
            v1: 'MOOD: Playful, vibrant, energetic — punchy colors, youthful atmosphere, the kind of image that gets a double-tap in 0.3 seconds.',
            v2: 'CAMERA: Crop for vertical/square formats. Dynamic angles, editorial energy, bold composition with strong foreground subject and minimal background noise.',
            v3: 'WORLD: Trendy, culturally relevant setting — flat-lay styling, street culture backdrop, or aesthetic lifestyle moment that feels native to social feeds.',
        },
        ecommerce: {
            brief: 'E-COMMERCE — conversion-optimized product photography that answers every buyer question. Clean, trustworthy, detail-forward, zero distraction.',
            v1: 'MOOD: Clinical clarity meets approachability — clean, honest, trust-building. The buyer should feel they have seen every detail.',
            v2: 'CAMERA: Multiple-angle coverage mindset — straight-on hero shot with optimal product framing, balanced exposure, maximum detail fidelity throughout.',
            v3: 'WORLD: Pure studio environment — seamless white or neutral background, product-only composition. Occasionally soft shadow for depth, never background distraction.',
        },
        brand: {
            brief: 'BRAND IDENTITY — cohesive, story-driven imagery that communicates brand values, personality, and long-term positioning beyond any single product.',
            v1: 'MOOD: Brand-signature atmosphere — evoke the specific emotional territory the brand owns. Is it raw and artisan? Sleek and technological? Warm and human?',
            v2: 'CAMERA: Editorial storytelling perspective — environmental portrait style, subject in context, medium-wide shot that shows the brand world not just the product.',
            v3: 'WORLD: Brand-universe setting — locations, textures, and contexts that reinforce brand values. Every background element is a brand signal.',
        },
        abtesting: {
            brief: 'A/B TESTING — maximally differentiated variants for rigorous performance comparison. Each variant makes a distinct creative hypothesis. No two look alike.',
            v1: 'MOOD: Hypothesis A — warm, emotional, story-driven atmosphere. High-warmth color grading, soft light, intimate human energy.',
            v2: 'CAMERA: Hypothesis B — radically different perspective from the source. If original is close-up, go wide. If frontal, go profile. Maximum compositional contrast.',
            v3: 'WORLD: Hypothesis C — entirely different environment from the source. Swap indoor for outdoor, studio for lifestyle, abstract for concrete. Test the context assumption.',
        },
        seasonal: {
            brief: 'SEASONAL / CAMPAIGN — time-bound imagery that connects the product to a specific moment, season, or cultural event. Strong seasonal atmosphere and cultural relevance.',
            v1: 'MOOD: Seasonal emotional resonance — capture the specific feeling of the season: summer freedom, winter warmth, autumn nostalgia, spring freshness.',
            v2: 'CAMERA: Campaign-ready framing — cinematic composition with seasonal atmospheric depth. Use seasonal light: golden summer haze, crisp winter clarity, moody autumn.',
            v3: 'WORLD: Seasonal environment fully realized — seasonal props, natural elements, lighting conditions and settings that are unmistakably time-anchored.',
        },
        studio: {
            brief: 'STUDIO PHOTOSHOOT — polished, controlled professional photography achieved in a purpose-built studio. Think editorial magazine spreads, high-fashion product tables, and luxury brand campaigns. Every light source is intentional; every shadow is placed.',
            v1: 'MOOD: Studio signature atmosphere — shift between three distinct studio moods: (A) high-key clean white seamless with crisp catch-lights; (B) low-key dramatic black seamless with single hard key light and deep shadows; (C) warm mid-tone seamless with large soft-box wrap.',
            v2: 'CAMERA: Classic studio technique — vary between (A) eye-level medium shot on 85mm for product intimacy; (B) slightly elevated three-quarter angle showing dimensionality; (C) flat-on overhead "lay-flat" style for graphic composition. Studio marks on floor imply precise, repeatable setups.',
            v3: 'WORLD: Studio set design — vary the constructed environment within the studio: (A) pure seamless infinity curve, no props; (B) styled product table with curated surface textures (marble, wood, brushed metal); (C) minimal editorial set with geometric blocks or fabric drape creating architectural depth.',
        },
        cinematic: {
            brief: 'CINEMATIC PHOTOSHOOT — imagery with the visual grammar of premium film and television. Motion picture color science, anamorphic lens character, intentional grain, and narrative depth of field. Every frame feels like a still from a prestige production.',
            v1: 'MOOD: Cinematic emotional register — choose one: (A) golden-hour Hollywood warmth — rich amber tones, lens flare, haze in the air, the feeling of an American road movie; (B) cool Nordic noir — desaturated blue-grey palette, flat soft overcast light, austere and melancholic; (C) neon-soaked neo-noir — deep shadows, practical light sources (neon, tungsten), high contrast.',
            v2: 'CAMERA: Anamorphic cinema language — simulate anamorphic 2.39:1 aspect ratio character: bokeh ovals, horizontal lens flare streaks, slight barrel distortion at edges. Use (A) close telephoto compression, (B) deep-focus wide establishing, or (C) handheld intimate medium. Add subtle film grain (ISO 800–3200 character).',
            v3: 'WORLD: Cinematic location — pull the subject into a world that reads as a film set: (A) rain-slicked nighttime street, wet pavement reflections, practical street lamp glow; (B) sun-drenched open landscape, sparse, wide horizon, dust in the air; (C) interior location with strong window light, dramatic shadow geometry cutting across the frame.',
        },
    };

    private async buildVariantPrompts(
        analysis: ImageAnalysis,
        purpose: VariantPurpose | undefined,
        userTouch?: string,
    ): Promise<Array<{ prompt: string; label: string; dimension: string }>> {
        const resolvedPurpose = purpose ?? 'marketing';
        const ctx = this.PURPOSE_CONTEXT[resolvedPurpose];

        const colorDescription = analysis.color_palette.join(', ');
        const userTouchInstruction = userTouch
            ? `User creative direction: "${userTouch}". Weave this as a soft nudge across all 3 prompts — it steers without overriding dimension rules or the color law.`
            : 'No user direction provided — rely entirely on the analysis and purpose brief to make all creative decisions.';

        const systemPrompt = `You are a world-class image generation prompt engineer with deep expertise in Imagen 4 by Google DeepMind. Your prompts are used by top creative studios and consistently produce exceptional results.

Your task: write exactly 3 variant image generation prompts from a detailed source image analysis. Each variant explores ONE creative dimension while holding all others constant — and every creative decision is purpose-driven by the campaign brief below.

━━━ PURPOSE BRIEF ━━━
${ctx.brief}
This purpose is your north star. Every creative decision — mood, camera, environment — must serve this intent.

━━━ DIMENSION RULES ━━━

VARIANT 1 — MOOD & ATMOSPHERE
Preserve: subject identity, composition framing, camera angle, product presentation, lighting setup
Shift: emotional tone, atmospheric feel, color grading, ambient energy
Purpose directive: ${ctx.v1}

VARIANT 2 — CAMERA & PRESENTATION
Preserve: mood direction, subject identity, lighting quality, color palette
Shift: camera angle, lens character, subject distance, depth of field, compositional framing
Purpose directive: ${ctx.v2}

VARIANT 3 — WORLD & CONTEXT
Preserve: subject identity, mood direction, photographic style, lighting character
Shift: environment, setting, background, surrounding narrative
Purpose directive: ${ctx.v3}

━━━ HARD LAWS ━━━
COLOR LAW: Every prompt MUST explicitly preserve the dominant palette [${colorDescription}]. Use the exact phrase: "maintaining the signature [describe palette character] color palette". Only override if user direction explicitly requests a color change.
SELF-CONTAINED: Each prompt is fully self-contained. Never write "same as original", "as before", or "like the source". Describe everything from scratch as if briefing a photographer who has never seen the source.
SUBJECT FIDELITY: The core subject/product must remain unmistakably itself.
USER DIRECTION: ${userTouchInstruction}

━━━ PROMPT ANATOMY ━━━
Structure every prompt in this exact order:
① Subject — what it is, defining visual identity, key physical characteristics
② Camera perspective — angle, distance, lens character (85mm portrait / 35mm environmental / macro intimacy)
③ Lighting — type, direction, quality, temperature, signature effects
④ Setting / environment / background
⑤ Mood, atmosphere, color grading — purpose-driven
⑥ Color palette preservation (mandatory)
⑦ Technical quality anchors — pick 2-3: "sharp commercial photography" · "shot on Hasselblad medium format" · "85mm f/1.4 shallow depth of field" · "Sony A7R V resolution" · "professional studio lighting" · "editorial photography quality" · "photorealistic 8K render" · "clean specular highlights, rich shadow detail" · "zero chromatic aberration"

Target: 150-200 words per prompt. Imagen 4 performs best with photography-language-rich, technically precise prompts.

━━━ OUTPUT ━━━
Return ONLY a valid JSON array — no markdown, no explanation, nothing before or after the brackets:
[
  { "prompt": "...", "label": "2-3 word label", "dimension": "mood_vibe" },
  { "prompt": "...", "label": "2-3 word label", "dimension": "product_presentation" },
  { "prompt": "...", "label": "2-3 word label", "dimension": "context" }
]`;

        const userMessage = `SOURCE IMAGE ANALYSIS:

Mood & Vibe: ${analysis.mood_vibe}
Product Presentation: ${analysis.product_presentation}
Lighting: ${analysis.lighting}
Context: ${analysis.context}
Technical Style: ${analysis.technical_style}
Color Palette: ${colorDescription}

Generate the 3 variant prompts now.`;

        const promptTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Prompt generation timed out')), 45_000)
        );
        const response = await Promise.race([
            this.genAI.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [{ text: userMessage }] }],
                config: {
                    systemInstruction: systemPrompt,
                    thinkingConfig: { thinkingBudget: 0 },
                } as any,
            }),
            promptTimeout,
        ]);

        return this.parseJsonSafely<Array<{ prompt: string; label: string; dimension: string }>>(
            (response as any).text ?? '',
            'Variant prompts',
        );
    }

    async generateVariants(dto: VariantsRequestDto & { userId: string }): Promise<VariantsResponseDto> {
        if (!this.genAI) {
            return { success: false, variants: [], error: 'AI Service not configured. Please set GEMINI_API_KEY.' };
        }

        this.logger.log(`generateVariants: purpose=${dto.purpose ?? 'marketing'}, touch="${dto.userTouch ?? ''}"`);

        try {
            const analysis = await this.analyzeImageForVariants(dto.imageUrl);
            this.logger.log(`[variants] analysis done — mood: "${analysis.mood_vibe.slice(0, 60)}…"`);

            const variantDefs = await this.buildVariantPrompts(
                analysis,
                dto.purpose,
                dto.userTouch,
            );
            this.logger.log(`[variants] built ${variantDefs.length} variant prompts`);

            const results = await Promise.allSettled(
                variantDefs.map(def =>
                    this.generateImage({
                        prompt: def.prompt,
                        model: 'imagen-4.0-generate-001',
                        canvasId: dto.canvasId,
                        aspectRatio: dto.aspectRatio ?? '1:1',
                        numberOfImages: 1,
                        userId: dto.userId,
                    })
                )
            );

            const variants: VariantItem[] = [];
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (r.status === 'fulfilled' && r.value.success && r.value.images[0]) {
                    variants.push({ image: r.value.images[0], label: variantDefs[i].label, dimension: variantDefs[i].dimension });
                } else {
                    const msg = r.status === 'rejected' ? r.reason?.message : r.value.error;
                    this.logger.warn(`[variants] variant ${i + 1} failed: ${msg}`);
                }
            }

            if (!variants.length) {
                return { success: false, variants: [], error: 'All variants failed to generate. Please try again.' };
            }

            return { success: true, variants };
        } catch (error) {
            this.logger.error(`generateVariants error: ${error.message}`, error.stack);
            return { success: false, variants: [], error: error.message ?? 'Variants generation failed. Please try again.' };
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
