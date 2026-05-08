import {
  IsString,
  IsIn,
  IsBoolean,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  VALID_MODEL_IDS,
  VALID_MODES,
  VALID_DURATIONS,
  VALID_ASPECT_RATIOS,
  type KlingModelId,
  type KlingMode,
  type KlingAspectRatio,
  type KlingDuration,
} from '../constants/kling-models';

export class TextToVideoDto {
  @ApiProperty({ description: 'Video generation prompt', minLength: 1, maxLength: 2500 })
  @IsString()
  @MinLength(1)
  @MaxLength(2500)
  prompt: string;

  @ApiProperty({ enum: VALID_MODEL_IDS, description: 'Kling model to use' })
  @IsIn(VALID_MODEL_IDS)
  model: KlingModelId;

  @ApiProperty({ enum: VALID_MODES, description: 'Generation mode: std (faster/720p), pro (higher quality/1080p), 4k (v3 only)' })
  @IsIn(VALID_MODES)
  mode: KlingMode;

  @ApiProperty({ enum: VALID_DURATIONS, description: 'Video duration in seconds — pass as string: "5", "10", or "15"' })
  @IsString()
  @IsIn(VALID_DURATIONS)
  duration: KlingDuration;

  @ApiProperty({ enum: VALID_ASPECT_RATIOS, description: 'Video aspect ratio' })
  @IsIn(VALID_ASPECT_RATIOS)
  aspect_ratio: KlingAspectRatio;

  @ApiProperty({ description: 'Enable AI-generated audio (requires kling-v3-omni)' })
  @IsBoolean()
  audio: boolean;

  @ApiPropertyOptional({ description: 'Negative prompt — things to avoid in the video', maxLength: 2500 })
  @IsOptional()
  @IsString()
  @MaxLength(2500)
  negative_prompt?: string;
}
