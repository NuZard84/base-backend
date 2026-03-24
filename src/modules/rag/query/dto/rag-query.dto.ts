import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsIn,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RagQueryDto {
  @ApiProperty({ description: 'The question to ask your documents', example: 'What was the revenue in Q3?' })
  @IsString()
  @MinLength(1)
  query: string;

  @ApiPropertyOptional({ description: 'Restrict retrieval to these document IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];

  @ApiPropertyOptional({ description: 'AI provider', enum: ['gemini', 'openai', 'claude'], default: 'gemini' })
  @IsOptional()
  @IsIn(['gemini', 'openai', 'claude'])
  provider?: string;

  @ApiPropertyOptional({ description: 'Model override', example: 'gemini-1.5-pro' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'Max chunks to retrieve', default: 10 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(30)
  limit?: number;

  @ApiPropertyOptional({ description: 'Minimum similarity threshold (0-1)', default: 0.35 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  similarityThreshold?: number;
}

export class VectorSearchDto {
  @ApiProperty({ description: 'Search query' })
  @IsString()
  @MinLength(1)
  query: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(30)
  limit?: number;

  @ApiPropertyOptional({ default: 0.35 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  similarityThreshold?: number;
}
