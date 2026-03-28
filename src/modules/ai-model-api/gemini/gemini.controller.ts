import { Controller, Post, Get, Body, Query, BadRequestException, Logger, UseGuards, Request } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { ApiTags, ApiOperation, ApiBody, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PlanGuard } from '../../../common/plans/plan.guard';
import { CheckLimit, RequireFeature } from '../../../common/plans/plan.decorator';
import { PlanService } from '../../../common/plans/plan.service';
import { RESOURCE_TYPES } from '../../../common/plans/plan-config';
import { Throttle } from '@nestjs/throttler';

import { AiRequestData, AiRequestConfig, ImageGenRequestDto, ImageGenResponseDto } from '../types';

@ApiTags('AI Gemini')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('ai/gemini')
export class GeminiController {
    constructor(
        private readonly geminiService: GeminiService,
        private readonly planService: PlanService,
    ) { }

    @Post('generate')
    @UseGuards(PlanGuard)
    @CheckLimit('ai_requests')
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
    async generate(@Body() body: { data: AiRequestData; config?: AiRequestConfig }, @Request() req: any) {
        const result = await this.geminiService.generateContent(body.data, body.config);
        // Log usage after successful generation
        await this.planService.logUsage(req.user.userId, RESOURCE_TYPES.AI_REQUEST, 1, {
            model: body.config?.model || 'gemini-2.0-flash-lite',
        });
        return result;
    }

    @Post('generate-image')
    @UseGuards(PlanGuard)
    @RequireFeature('imageGeneration')
    @CheckLimit('image_gen')
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @ApiOperation({ summary: 'Generate images using Imagen 4 or Gemini native image models' })
    async generateImage(@Body() body: ImageGenRequestDto, @Request() req: any): Promise<ImageGenResponseDto> {
        if (!body.prompt?.trim()) {
            throw new BadRequestException('prompt must not be empty');
        }
        // Note: usage logging is done inside geminiService.generateImage (fire-and-forget)
        // to include the actual number of images generated. Do NOT log here again.
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
    async search(@Query('q') q: string, @Request() req: any) {
        if (!q?.trim()) {
            throw new BadRequestException('Query parameter "q" must not be empty.');
        }
        const result = await this.geminiService.getRealTimeData(q.trim());
        // Log search as AI request usage
        await this.planService.logUsage(req.user.userId, RESOURCE_TYPES.AI_REQUEST, 1, {
            type: 'search',
            query: q.substring(0, 100),
        });
        return result;
    }
}
