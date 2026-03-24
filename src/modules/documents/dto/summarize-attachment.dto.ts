import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SummarizeAttachmentDto {
  @ApiPropertyOptional({
    description: 'AI provider to use for summarization',
    enum: ['gemini', 'openai', 'claude'],
    example: 'gemini',
  })
  @IsOptional()
  @IsString()
  @IsIn(['gemini', 'openai', 'claude'])
  provider?: string;

  @ApiPropertyOptional({
    description: 'Custom instruction appended to the summarization prompt',
    example: 'Focus on the financial figures and key takeaways.',
  })
  @IsOptional()
  @IsString()
  customPrompt?: string;

  @ApiPropertyOptional({
    description: 'Response length hint',
    enum: ['short', 'medium', 'long'],
    default: 'medium',
  })
  @IsOptional()
  @IsIn(['short', 'medium', 'long'])
  responseLength?: 'short' | 'medium' | 'long';

  @ApiPropertyOptional({
    description: 'Provider-specific model override (e.g. "gemini-1.5-pro")',
    example: 'gemini-1.5-pro',
  })
  @IsOptional()
  @IsString()
  model?: string;
}
