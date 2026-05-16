import { Controller, Post, Get, Body, Query, BadRequestException, ForbiddenException, UseGuards, Request } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { ApiTags, ApiOperation, ApiBody, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PlanGuard } from '../../../common/plans/plan.guard';
import { CheckLimit, RequireFeature } from '../../../common/plans/plan.decorator';
import { PlanService } from '../../../common/plans/plan.service';
import { RESOURCE_TYPES, FREE_TIER_AI_MODELS } from '../../../common/plans/plan-config';
import { CreditService } from '../../../common/credits/credit.service';
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
        private readonly creditService: CreditService,
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
        const userId: string = req.user.userId;
        const requestedModel = body.config?.model || 'gemini-2.0-flash-lite';
        if (!FREE_TIER_AI_MODELS.has(requestedModel)) {
            await this.planService.requireFeature(userId, 'advancedAiModels');
        }
        await this.creditService.grantMonthlyCredits(userId);
        const costPer1k = await this.creditService.getCost('ai_request_per_1k_tokens');
        await this.creditService.check(userId, costPer1k); // minimum 1k tokens cost pre-check
        const result = await this.geminiService.generateContent(body.data, body.config);
        const tokens = result.tokenUsage?.totalTokens ?? 0;
        await this.planService.logUsage(
            userId,
            RESOURCE_TYPES.AI_REQUEST,
            1,
            { model: requestedModel },
            tokens,
        );
        if (tokens > 0) {
            const costPer1k = await this.creditService.getCost('ai_request_per_1k_tokens');
            await this.creditService.deduct(
                userId,
                Math.ceil(tokens / 1000) * costPer1k,
                `ai_request:${requestedModel}`,
                RESOURCE_TYPES.AI_REQUEST,
            );
        }
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
        const userId: string = req.user?.userId;
        await this.creditService.grantMonthlyCredits(userId);
        const costPerImage = await this.creditService.getCost('image_gen');
        const expectedCount = body.numberOfImages ?? 1;
        await this.creditService.check(userId, costPerImage * expectedCount);
        // Usage logging is done inside geminiService.generateImage (fire-and-forget)
        // to include the actual number of images generated. Do NOT log here again.
        const result = await this.geminiService.generateImage({ ...body, userId });
        const imageCount = result.images?.length ?? 1;
        await this.creditService.deduct(
            userId,
            imageCount * costPerImage,
            'image_gen',
            RESOURCE_TYPES.IMAGE_GEN,
        );
        return result;
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
        const userId: string = req.user.userId;
        await this.creditService.grantMonthlyCredits(userId);
        const costPer1k = await this.creditService.getCost('ai_request_per_1k_tokens');
        await this.creditService.check(userId, costPer1k);
        const result = await this.geminiService.getRealTimeData(q.trim());
        const tokens = result.tokenUsage?.totalTokens ?? 0;
        await this.planService.logUsage(
            userId,
            RESOURCE_TYPES.AI_REQUEST,
            1,
            { type: 'search', query: q.substring(0, 100) },
            tokens,
        );
        if (tokens > 0) {
            const costPer1k = await this.creditService.getCost('ai_request_per_1k_tokens');
            await this.creditService.deduct(
                userId,
                Math.ceil(tokens / 1000) * costPer1k,
                'ai_request:search',
                RESOURCE_TYPES.AI_REQUEST,
            );
        }
        return result;
    }
}
