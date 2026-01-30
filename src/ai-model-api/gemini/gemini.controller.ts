import { Controller, Post, Body, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';

@ApiTags('AI Gemini')
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
    async generate(@Body() body: { data: { prompt?: string; ask: string; type?: string }; config?: { model?: string; responseLength?: string } }) {

        return this.geminiService.generateContent(body.data, body.config);
    }
}
