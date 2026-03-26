import { Controller, Post, Get, Body, Query, BadRequestException, Logger, UseGuards, Request } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { ApiTags, ApiOperation, ApiBody, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

import { AiRequestData, AiRequestConfig, ImageGenRequestDto, ImageGenResponseDto } from '../types';

@ApiTags('AI Gemini')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('ai/gemini')
export class GeminiController {
    constructor(private readonly geminiService: GeminiService) { }

    @Post('generate')
    @ApiOperation({ summary: 'Generate AI response using Gemini' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                data: {
                    type: 'object',
                    properties: {
                        prompt: { type: 'string', example: 'Context about the request' },
                        ask: { type: 'string', example: 'What is a bit?' },
                        type: { type: 'string', example: 'summarize' },
                        history: {
                            type: 'array',
                            description: 'Optional conversation history for multi-turn context',
                            items: {
                                type: 'object',
                                properties: {
                                    role: { type: 'string', enum: ['user', 'model'] },
                                    text: { type: 'string' },
                                },
                                required: ['role', 'text'],
                            },
                        },
                    },
                    required: ['ask'],
                },
                config: {
                    type: 'object',
                    properties: {
                        model: { type: 'string', example: 'gemini-2.0-flash-lite' },
                        responseLength: { type: 'string', example: 'medium' },
                        isSearch: {
                            type: 'boolean',
                            example: true,
                            description: 'Enable Google Search Grounding for real-time internet data. Returns sources[] in the response.',
                        },
                    },
                },
            },
        },
    })
    async generate(@Body() body: { data: AiRequestData; config?: AiRequestConfig }) {

        return this.geminiService.generateContent(body.data, body.config);
    }

    @Post('generate-image')
    @ApiOperation({ summary: 'Generate images using Imagen 4 or Gemini native image models' })
    async generateImage(@Body() body: ImageGenRequestDto, @Request() req: any): Promise<ImageGenResponseDto> {
        if (!body.prompt?.trim()) {
            throw new BadRequestException('prompt must not be empty');
        }
        return this.geminiService.generateImage({ ...body, userId: req.user?.userId });
    }

    @Get('search')
    @ApiOperation({
        summary: 'Real-time search via Gemini (Google Search Grounding)',
        description:
            'Sends a search prompt to Gemini with Google Search Grounding enabled. ' +
            'Returns an AI-generated answer with cited source URLs from the live web.',
    })
    @ApiQuery({
        name: 'q',
        required: true,
        description: 'The search prompt / question to answer with real-time data.',
        example: 'What is the current price of Bitcoin?',
    })
    async search(@Query('q') q: string) {
        if (!q?.trim()) {
            throw new BadRequestException('Query parameter "q" must not be empty.');
        }
        return this.geminiService.getRealTimeData(q.trim());
    }
}
