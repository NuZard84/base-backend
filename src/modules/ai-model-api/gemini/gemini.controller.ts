import { Controller, Post, Body, Logger, UseGuards } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

import { AiRequestData, AiRequestConfig } from '../types';

@ApiTags('AI Gemini')
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
                    },
                    required: ['ask'],
                },
                config: {
                    type: 'object',
                    properties: {
                        model: { type: 'string', example: 'gemini-2.0-flash-lite' },
                        responseLength: { type: 'string', example: 'medium' },
                    },
                },
            },
        },
    })
    async generate(@Body() body: { data: AiRequestData; config?: AiRequestConfig }) {

        return this.geminiService.generateContent(body.data, body.config);
    }
}
