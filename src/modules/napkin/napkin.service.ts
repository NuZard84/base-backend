import { Injectable, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerateVisualDto } from './dto/generate-visual.dto';
import { STRUCTURES, type StructureKey } from './structures';
import { GeminiService } from '../ai-model-api/gemini/gemini.service';

// Real response shape from the Napkin API
export interface NapkinFile {
    url: string;
    visual_id: string;
    style_id: string;
    width: number;
    height: number;
    color_mode: string;
}

export interface NapkinStatusResponse {
    id: string;
    status: 'pending' | 'completed' | 'failed';
    request?: Record<string, unknown>;
    generated_files?: NapkinFile[];
    credits?: { consumed: number };
}

@Injectable()
export class NapkinService {
    private readonly logger = new Logger(NapkinService.name);
    private readonly baseUrl = 'https://api.napkin.ai/v1';
    private readonly apiKey: string;

    constructor(
        private readonly config: ConfigService,
        private readonly gemini: GeminiService,
    ) {
        this.apiKey = this.config.get<string>('NAPKIN_API_KEY') ?? '';
        if (!this.apiKey) {
            this.logger.warn('NAPKIN_API_KEY is not set — Napkin visual generation will fail');
        }
    }

    async createVisualRequest(dto: GenerateVisualDto): Promise<{ request_id: string }> {
        let content = dto.text;

        if (dto.structure && dto.structure !== 'none') {
            const structureDef = STRUCTURES[dto.structure as StructureKey];
            if (structureDef) {
                const shouldExpand = dto.expand_prompt !== false; // default true
                if (shouldExpand && structureDef.systemPrompt) {
                    // Use Gemini to expand the user's vague input into rich structured content.
                    // Falls back silently to buildContent() if Gemini fails.
                    this.logger.debug(`Expanding prompt via Gemini for structure: ${dto.structure}`);
                    content = await this.gemini.expandForVisual(structureDef.systemPrompt, dto.text);
                    this.logger.debug(`Expanded content (${content.length} chars): ${content.substring(0, 120)}…`);
                } else {
                    content = structureDef.buildContent(dto.text);
                }
            }
        }

        const body: Record<string, unknown> = {
            content,
            language: dto.language?.trim() || 'en',
            format: dto.format ?? 'svg',
            number_of_visuals: dto.number_of_visuals ?? 1,
            color_mode: dto.color_mode?.trim() || 'light',
            orientation: dto.orientation?.trim() || 'auto',
        };

        if (dto.style_id?.trim()) body['style_id'] = dto.style_id.trim();
        if (dto.context_before?.trim()) body['context_before'] = dto.context_before.trim();
        if (dto.context_after?.trim()) body['context_after'] = dto.context_after.trim();
        if (dto.transparent_background !== undefined) body['transparent_background'] = dto.transparent_background;

        this.logger.debug(`Creating Napkin visual request: ${JSON.stringify(body)}`);

        const res = await fetch(`${this.baseUrl}/visual`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.text();
            this.logger.error(`Napkin API error ${res.status}: ${err}`);
            throw new InternalServerErrorException(`Napkin API error: ${res.status} ${err}`);
        }

        const data = await res.json() as { id?: string };
        const requestId = data.id;
        if (!requestId) {
            throw new InternalServerErrorException('Napkin API did not return an id');
        }

        return { request_id: requestId };
    }

    async getVisualStatus(requestId: string): Promise<NapkinStatusResponse> {
        const res = await fetch(`${this.baseUrl}/visual/${requestId}/status`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
        });

        if (res.status === 404) throw new NotFoundException(`Napkin request ${requestId} not found`);
        if (res.status === 410) throw new NotFoundException(`Napkin request ${requestId} has expired`);
        if (!res.ok) {
            const err = await res.text();
            throw new InternalServerErrorException(`Napkin status error: ${res.status} ${err}`);
        }

        return res.json() as Promise<NapkinStatusResponse>;
    }

    async downloadFile(fileUrl: string): Promise<{ data: Buffer; contentType: string }> {
        const res = await fetch(fileUrl, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
        });

        if (!res.ok) {
            throw new InternalServerErrorException(`Failed to download Napkin file: ${res.status}`);
        }

        const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
        const arrayBuffer = await res.arrayBuffer();
        return { data: Buffer.from(arrayBuffer), contentType };
    }
}
