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
                            text: `You are a senior creative director, commercial photographer, and brand strategist. Analyze this image with the technical and strategic precision required to brief a world-class studio on recreating, extending, and commercializing it across marketing channels.

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

mood_vibe — 2-3 sentences: the emotional register, psychological atmosphere, and commercial energy. What instant feeling does this trigger in a viewer? Describe both the sensory experience and the purchase impulse or brand emotion it activates — warm/cold, urgent/calm, luxurious/accessible, aspirational/relatable, premium/playful.

product_presentation — precise commercial photography description: subject category (person/product/lifestyle scene/abstract), subject angle (frontal/3-quarter/profile/overhead/low-angle/dutch-tilt), subject distance (macro detail/close-up/medium/environmental wide), depth of field treatment (tack-sharp commercial/selective focus bokeh/heavy cinematic bokeh), composition principle (centered product-hero/rule-of-thirds/negative space dominant/symmetrical/dynamic diagonal), how the composition directs viewer attention to the commercial focal point.

lighting — full lighting brief: source type (natural window/continuous studio/strobe/practical ambient/mixed), key light direction (frontal/45-degree Rembrandt/side dramatic/backlit rim/overhead flat/under-lighting), light quality (hard-edged specular/soft-diffused wrap/bounced fill/gradient falloff), color temperature (warm tungsten 2700-3200K/neutral daylight 5000-5500K/cool blue-white 6500K+), shadow character (deep pools/soft gradients/eliminated shadows/directional cast), any signature commercial effects (catch-lights in eyes/specular product highlights/rim separation from background/glowing product translucency).

context — commercial context brief: setting category (seamless studio infinity/lifestyle residential/outdoor natural/urban street/abstract graphic/branded environment), brand tier (ultra-luxury/premium/premium-accessible/masstige/artisan craft/editorial), commercial channel fit (DTC hero product/social content/editorial print/retail POS/brand campaign), narrative intent (pure product showcase/aspirational lifestyle/documentary real/conceptual artistic).

technical_style — full rendering fingerprint: film vs clean digital character, grain/noise presence (none/invisible/subtle analog/prominent filmic), color grading signature (clean true neutral/matte lifted blacks/high-contrast cinematic S-curve/desaturated editorial/richly saturated commercial/faded vintage), tonal contrast character (flat low-contrast/standard/contrasty/high-contrast dramatic), sharpness quality (ultra-sharp commercial/natural resolved/slightly soft romantic), post-processing fingerprint (minimal natural/color-story graded/heavily treated/raw documentary).

color_palette — 4-6 dominant hex codes ordered strictly by visual dominance in the frame. These become absolute color anchors in generation — extract from the actual image pixels with precision.`,
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
            brief: 'MARKETING HERO — high-impact commercial imagery engineered to stop a scroll, communicate premium value, and convert a viewer into a buyer within 2 seconds. Aspirational staging, bold product-forward composition, purchase-driving energy. Think agency campaign for a premium product launch.',
            v1: 'MOOD: Shift to confident, aspirational purchase energy — the image should feel premium, desirable, and instantly communicative of value. Warm-neutral color temperature, elevated contrast, rich shadow detail. The viewer should feel they want this product before they consciously process what it is.',
            v2: 'CAMERA: Commercial hero shot — slight low angle (empowering the subject), tight product-forward framing, razor-sharp primary focus, ultra-shallow depth of field (f/1.4–f/2) that sculpts the subject from the background. Every centimetre of DOF falloff directs the eye with intention.',
            v3: 'WORLD: Aspirational lifestyle context — place the subject in an environment that signals the aspirational identity of the buyer: premium modern interior with architectural detail, curated urban lifestyle setting, or ultra-clean commercial studio with precise shadow geometry. Every background element reinforces the value proposition.',
        },
        social: {
            brief: 'SOCIAL MEDIA CONTENT — platform-native thumb-stopping imagery for Instagram, TikTok, and Pinterest feeds. Vibrant, bold, optimized for 375px-wide viewports and 0.3-second attention windows. High visual energy with instant emotional hook. Designed to earn a double-tap or a save.',
            v1: 'MOOD: Playful, vibrant, high-dopamine energy — punchy saturated colors within the source palette, youthful atmosphere, bold tonal contrast. The image should communicate its emotion instantly at thumbnail scale without any caption needed.',
            v2: 'CAMERA: Feed-optimized framing — crop for vertical 4:5 or square 1:1 formats with strong central subject and bold negative space. Dynamic angles (dutch tilt, close editorial crop), high-contrast foreground-background separation, zero visual clutter competing with the primary subject.',
            v3: 'WORLD: Culturally resonant, trend-forward setting — aesthetic flat-lay with textural props, street-culture lifestyle backdrop, or aspirational "day in the life" moment. The environment should feel authentic to the platform aesthetic: not a stock photo, but a creator-grade content image.',
        },
        ecommerce: {
            brief: 'E-COMMERCE CONVERSION — product photography engineered for maximum conversion rate on retail platforms (Amazon, Shopify, DTC storefronts). Answers every buyer question visually: what is it, how big, what does it feel like, why should I trust it. Zero distraction, maximum product truth.',
            v1: 'MOOD: Clinical clarity meets approachability — honest, trustworthy, detail-forward without being sterile. Clean color accuracy — the product should look exactly as it will arrive. The buyer must feel they have complete visual information and zero purchase risk.',
            v2: 'CAMERA: Hero product angle — straight-on primary view with balanced even exposure, maximum depth of field (f/8–f/11) for full product sharpness, composition that shows the product at approximately 70-80% of frame. Every material surface, texture, and edge should be crisply resolved.',
            v3: 'WORLD: Pure studio conversion environment — seamless white or light neutral backdrop (pure white #FFFFFF or warm white #F8F5F0), product as the sole compositional element. Optional: precise drop shadow or subtle reflection beneath the product to communicate dimensionality without distraction.',
        },
        brand: {
            brief: 'BRAND STORYTELLING — cohesive, values-driven imagery that communicates brand identity, personality, and long-term emotional positioning. Not a product shot — a brand world. Every frame should feel like it belongs to a recognisable creative system. Think campaign lookbook, not catalogue.',
            v1: 'MOOD: Brand-signature emotional territory — identify and amplify the specific feeling the brand owns exclusively. If the source reads premium, push toward understated luxury. If artisan, push toward craft authenticity. If technical, push toward precision and control. Mood is the brand fingerprint.',
            v2: 'CAMERA: Editorial brand perspective — environmental storytelling angle that shows subject in context (medium-wide 35mm character), depth of field that reveals the brand world while keeping the subject primary, composition with intentional negative space that communicates brand confidence.',
            v3: 'WORLD: Brand universe environment — locations, surfaces, textures, and context elements that are unmistakably on-brand. Every background detail is a brand signal: the materials, the light quality, the cultural context. The setting should make the brand identity legible without any logo present.',
        },
        abtesting: {
            brief: 'A/B CREATIVE TESTING — maximally differentiated variants for rigorous conversion performance comparison. Each variant embodies a distinct, testable creative hypothesis with clear independent variable. These must look completely different from each other — not color variations of the same composition.',
            v1: 'MOOD HYPOTHESIS: Test emotional warmth vs. authority — warm, emotionally resonant atmosphere with soft high-warmth light (3000K), intimate human energy, story-driven color grading. Hypothesis: emotional connection drives conversion.',
            v2: 'CAMERA HYPOTHESIS: Test composition radically — if the source is close-up, execute a wide environmental shot; if frontal, execute profile or overhead. Maximum compositional contrast from the source image. Hypothesis: perspective and distance changes relative perceived value.',
            v3: 'WORLD HYPOTHESIS: Test context assumption entirely — swap the complete environment type: studio for outdoor lifestyle, abstract for concrete location, solitary product for human-in-use context. Hypothesis: context and lifestyle association changes purchase intent.',
        },
        seasonal: {
            brief: 'SEASONAL CAMPAIGN — time-anchored imagery that forges an emotional connection between the product and a specific season, moment, or cultural event. The season should be felt immediately — not described, experienced. Creates urgency and time-bound desire.',
            v1: 'MOOD: Deep seasonal emotional resonance — distill the psychological essence of the season into color, light, and atmosphere: summer freedom and golden warmth, winter intimacy and candlelit comfort, autumn nostalgia and rich amber decay, spring renewal and fresh softness. The product inherits the season\'s emotional power.',
            v2: 'CAMERA: Campaign-cinematic framing — wide-to-medium seasonal establishing shot with atmospheric depth, seasonal bokeh, and time-of-day-appropriate light. Golden hour summer haze at f/2, crisp winter overcast at f/5.6, low-angle autumn sun at f/1.8. Let the light tell the season.',
            v3: 'WORLD: Seasonal environment fully realized — seasonal props, botanical elements, architectural contexts, and environmental conditions that are unmistakably month-specific. Nothing generic, nothing stock-photo seasonal: specific, concrete, immersive. The product belongs here naturally.',
        },
        studio: {
            brief: 'PROFESSIONAL STUDIO PHOTOSHOOT — polished, controlled commercial photography in a purpose-built studio. Think editorial magazine spreads for luxury brands, high-fashion product tables, and prestige campaign imagery. Every light source is intentional, every shadow is placed, every surface texture is a decision.',
            v1: 'MOOD: Studio lighting signature — explore three controlled studio atmospheres: (A) high-key clean white seamless — maximum fill, crisp catch-lights, clean specular highlights, elevated professional clinical; (B) low-key black seamless — single hard key light, deep inky shadows, dramatic product isolation; (C) warm mid-tone seamless — large soft-box wrap, gentle gradients, editorial luxury warmth.',
            v2: 'CAMERA: Precision studio technique — vary the classic studio angles: (A) eye-level 85mm intimate medium shot, subject fills 60-70% of frame; (B) slightly elevated 3-quarter angle at 50mm showing product dimensionality and depth; (C) flat-on overhead lay-flat perspective at 100mm for graphic product composition. Studio floor marks imply repeatable, precise setups.',
            v3: 'WORLD: Curated studio set design — vary the controlled environment: (A) pure seamless infinity curve, zero props, product only; (B) styled product table with deliberate surface texture — polished white marble, oiled dark walnut, brushed gunmetal steel; (C) minimal editorial geometric set with architectural blocks, fabric drape, or botanical element creating intentional depth without distraction.',
        },
        cinematic: {
            brief: 'CINEMATIC PHOTOGRAPHY — imagery with the full visual language of premium feature film and prestige television. Motion picture color science, anamorphic lens optical character, intentional ISO grain, and narrative depth of field. Every frame should feel like a unit still from a prestige production with a $100M budget.',
            v1: 'MOOD: Cinematic emotional register — choose one fully committed grade: (A) golden-hour Hollywood warmth — rich amber-orange tones, anamorphic lens flare, atmospheric haze, the sun-soaked feeling of an American prestige drama; (B) cool Nordic noir — desaturated blue-grey palette with lifted blacks, flat overcast light, austere and contemplative; (C) neon-soaked neo-noir night — deep blacks, practical neon and tungsten practicals, extreme contrast ratio, rain-wet surfaces.',
            v2: 'CAMERA: Anamorphic cinema optics — simulate the full anamorphic character: oval bokeh, horizontal lens-flare streaks, slight barrel distortion at frame edges, cinematic 2.39:1 widescreen framing. Select: (A) long telephoto compression (200mm+) collapsing background and subject; (B) deep-focus Kubrickian wide (24mm) with extreme foreground-to-background sharpness; (C) handheld intimate medium (50mm) with organic camera movement suggestion. Film grain at ISO 1600-3200 character is mandatory.',
            v3: 'WORLD: Cinematic production location — pull the subject into a fully realized film-set environment: (A) rain-slicked nighttime city street, wet pavement mirror reflections, practical street lamp pools of light, deep background falloff; (B) sun-drenched open landscape at magic hour, sparse horizon, atmospheric dust and haze, desolate American sublime; (C) interior practical-light location — dramatic window light geometry cutting hard shadows across architectural surfaces, shadow and highlight contrast at 10:1 ratio.',
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

        const systemPrompt = `You are the world's foremost image generation prompt engineer, with deep mastery of Imagen 4 Ultra and Gemini Pro image models. Your prompts are the benchmark used by tier-1 creative agencies, DTC brand studios, and performance marketing teams. Every prompt you write produces exceptional commercial-grade imagery on the first generation.

Your task: write exactly 3 variant image generation prompts derived from a detailed source image analysis. Each variant isolates and explores ONE creative dimension while holding all others constant — and every single creative decision is purpose-driven by the commercial campaign brief below. These prompts must produce images that are immediately usable in real marketing, social, or brand contexts.

━━━ CAMPAIGN PURPOSE BRIEF ━━━
${ctx.brief}
This is your commercial north star. Every creative decision — mood, camera treatment, environment — must serve this specific business intent and produce imagery that works for this exact use case.

━━━ DIMENSION ISOLATION RULES ━━━

VARIANT 1 — MOOD & ATMOSPHERE DIMENSION
What you MUST preserve: subject identity, core composition framing, camera angle and distance, product presentation geometry, existing lighting direction and setup
What you MUST shift: emotional tone and register, atmospheric color grading, ambient energy and feeling, tonal contrast character, psychological resonance
Commercial directive: ${ctx.v1}

VARIANT 2 — CAMERA & PRESENTATION DIMENSION
What you MUST preserve: mood direction and emotional register, subject identity and characteristics, lighting quality and color temperature, dominant color palette
What you MUST shift: camera angle, lens character and focal length, subject-to-camera distance, depth of field treatment, compositional framing and negative space distribution
Commercial directive: ${ctx.v2}

VARIANT 3 — WORLD & CONTEXT DIMENSION
What you MUST preserve: subject identity and core characteristics, established mood direction, photographic style and rendering quality, lighting character and color temperature
What you MUST shift: environment, setting, background narrative, contextual story, surrounding elements and props
Commercial directive: ${ctx.v3}

━━━ NON-NEGOTIABLE LAWS ━━━
COLOR ANCHOR LAW: Every prompt MUST explicitly preserve the dominant color palette [${colorDescription}]. State: "maintaining the signature [describe the palette character in 3-5 words] color palette anchored in [dominant hex]". Override ONLY if user direction explicitly requests a color shift.
SELF-CONTAINED BRIEFS: Every prompt stands alone as a complete photographer's brief. Never reference the source image with phrases like "same as original", "as before", "like the source", or "similar to". Write as if briefing a studio that has never seen the source.
SUBJECT AND PRODUCT FIDELITY: The core subject or product must remain unmistakably itself across all three variants. Identity is sacrosanct.
COMMERCIAL USABILITY: Every prompt must produce an image that works in the stated campaign context on day one — not conceptually interesting, but commercially deployable.
USER CREATIVE DIRECTION: ${userTouchInstruction}

━━━ PROMPT ANATOMY — FOLLOW THIS EXACT SEQUENCE ━━━
Structure every prompt with these seven components in this precise order:

① SUBJECT — category, defining visual identity, key physical characteristics, material properties, what makes it distinctive
② CAMERA — angle (eye-level/low/overhead/profile), distance (macro/close-up/medium/wide environmental), lens character (85mm f/1.4 portrait compression / 35mm f/1.8 environmental / 100mm macro detail / 24mm wide establishing), depth of field specification
③ LIGHTING — source type and setup (natural window diffuse / continuous softbox / strobe beauty dish / practical ambient), key light direction and angle, light quality (hard specular / soft wrap / bounced fill), color temperature (warm 3000K / neutral 5500K / cool 6500K), signature lighting effects (catch-lights / specular product highlights / rim separation / gradient falloff)
④ SETTING — specific environment with concrete details, surface textures, architectural elements, spatial depth cues, background treatment
⑤ MOOD & COLOR GRADE — emotional register, atmospheric energy, color grading character (clean neutral / lifted matte / S-curve cinematic / desaturated editorial), purpose-driven feeling
⑥ COLOR PALETTE — explicit preservation statement with hex anchor and palette character description (mandatory every prompt)
⑦ TECHNICAL QUALITY ANCHORS — select exactly 3 from: "sharp commercial photography" · "Hasselblad H6D medium format" · "85mm f/1.4 portrait lens" · "Sony A7R V full-frame resolution" · "Phase One IQ4 150MP" · "professional studio strobe lighting" · "editorial photography quality" · "photorealistic 8K commercial render" · "clean specular highlights with rich shadow detail" · "zero chromatic aberration" · "Leica M11 street reportage" · "Canon EOS R5 portrait mode" · "10-bit color depth commercial grade"

Target length: 160-220 words per prompt. Imagen 4 and Gemini Pro image models respond best to photography-language-rich, technically specific prompts that read like a real photographer's shoot brief.

━━━ OUTPUT FORMAT ━━━
Return ONLY a valid JSON array — no markdown, no explanation, no preamble, nothing before or after the brackets. Any non-JSON output will break the pipeline:
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
                        model: 'gemini-3-pro-image-preview',
                        canvasId: dto.canvasId,
                        aspectRatio: dto.aspectRatio ?? '1:1',
                        numberOfImages: 1,
                        userId: dto.userId,
                        referenceImageUrls: [dto.imageUrl],
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
