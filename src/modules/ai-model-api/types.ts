import { IsArray, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export const queryType = {
    VID_SUMMARIZE: 'vid_summarize'
}

export type AiRequestType = 'vid_summarize' | null;

/** Single message in conversation history for multi-turn context */
export interface HistoryMessage {
    role: 'user' | 'model';
    text: string;
}

export class AiRequestData {
    prompt?: string;
    ask: string;
    type?: AiRequestType;
    /** Optional conversation history for multi-turn context (alternating user/model) */
    history?: HistoryMessage[];
}

export class AiRequestConfig {
    model?: string;
    responseLength?: string;
    /** When true, enables Google Search Grounding for real-time internet data */
    isSearch?: boolean;
}

export class AiResponse {
    success: boolean;
    text: string;
    /** Populated only when isSearch is true — grounded web sources */
    sources?: { title: string; url: string }[];
}

export const VALID_IMAGE_GEN_MODELS = [
    'imagen-4.0-generate-001',
    'imagen-4.0-ultra-generate-001',
    'imagen-4.0-fast-generate-001',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
    'gemini-2.5-flash-image',
] as const;

export class ImageGenRequestDto {
    @IsString()
    prompt: string;

    @IsIn(VALID_IMAGE_GEN_MODELS, { message: `model must be one of: ${VALID_IMAGE_GEN_MODELS.join(', ')}` })
    model: string;

    @IsOptional()
    @IsString()
    canvasId?: string;             // for S3 path + DB tracking

    // Imagen 4 only
    @IsOptional()
    @IsNumber()
    numberOfImages?: number;       // 1–4

    @IsOptional()
    @IsString()
    aspectRatio?: string;          // '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | ...

    @IsOptional()
    @IsString()
    imageSize?: string;            // '1K' | '2K'

    // Gemini native models only
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    referenceImages?: string[];    // base64 data URLs (data:image/...;base64,...)
}

export interface GeneratedImageItem {
    url: string;    // presigned S3 URL (7-day expiry)
    id: string;     // Attachment DB id — use for delete
    key: string;    // S3 key — stored for URL refresh
}

export class ImageGenResponseDto {
    success: boolean;
    images: GeneratedImageItem[];
    error?: string;
}
