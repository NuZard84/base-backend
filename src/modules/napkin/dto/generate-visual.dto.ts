import { IsString, IsOptional, IsInt, IsBoolean, IsIn, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateVisualDto {
    @ApiProperty({ description: 'The text content to generate a visual from' })
    @IsString()
    text: string;

    @ApiPropertyOptional({ description: 'BCP 47 language tag (e.g. en, es, fr)', default: 'en' })
    @IsOptional()
    @IsString()
    language?: string;

    @ApiPropertyOptional({ description: 'Style ID — one of the 15 built-in IDs or a custom style ID' })
    @IsOptional()
    @IsString()
    style_id?: string;

    @ApiPropertyOptional({ description: 'Number of distinct visuals to generate (1–4)', default: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(4)
    number_of_visuals?: number;

    @ApiPropertyOptional({ description: 'Output format', enum: ['svg', 'png', 'ppt'], default: 'svg' })
    @IsOptional()
    @IsIn(['svg', 'png', 'ppt'])
    format?: string;

    @ApiPropertyOptional({ description: 'Color mode', enum: ['light', 'dark'], default: 'light' })
    @IsOptional()
    @IsIn(['light', 'dark'])
    color_mode?: string;

    @ApiPropertyOptional({ description: 'Orientation', enum: ['auto', 'horizontal', 'vertical', 'square'], default: 'auto' })
    @IsOptional()
    @IsIn(['auto', 'horizontal', 'vertical', 'square'])
    orientation?: string;

    @ApiPropertyOptional({ description: 'Context text that appears before the main content' })
    @IsOptional()
    @IsString()
    context_before?: string;

    @ApiPropertyOptional({ description: 'Context text that appears after the main content' })
    @IsOptional()
    @IsString()
    context_after?: string;

    @ApiPropertyOptional({ description: 'Transparent background (PNG only)' })
    @IsOptional()
    @IsBoolean()
    transparent_background?: boolean;

    @ApiPropertyOptional({
        description: 'Structure type key — one of the STRUCTURES keys (e.g. mindmap, process, timeline). ' +
            'When set the service uses Gemini to expand and structure the content before sending to Napkin.',
    })
    @IsOptional()
    @IsString()
    structure?: string;

    @ApiPropertyOptional({
        description: 'Whether to use Gemini AI to expand/enrich the content before sending to Napkin. ' +
            'Defaults to true when structure is set. Set to false to use the raw text + simple template only.',
        default: true,
    })
    @IsOptional()
    @IsBoolean()
    expand_prompt?: boolean;
}
