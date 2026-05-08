import {
  IsString,
  IsIn,
  IsBoolean,
  IsOptional,
  MinLength,
  MaxLength,
  registerDecorator,
  type ValidationOptions,
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

/**
 * Kling accepts either a publicly accessible HTTPS URL or a base64 data URI.
 * class-validator's @IsUrl rejects data URIs, so we use a custom validator.
 */
function IsUrlOrBase64(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isUrlOrBase64',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          // base64 data URI  (data:image/...;base64,...)
          if (/^data:image\/.+;base64,/.test(value)) return true;
          // HTTPS URL
          try {
            const url = new URL(value);
            return url.protocol === 'https:';
          } catch {
            return false;
          }
        },
        defaultMessage() {
          return '$property must be an HTTPS URL or a base64 image data URI';
        },
      },
    });
  };
}

export class ImageToVideoDto {
  @ApiProperty({ description: 'Video generation prompt', minLength: 1, maxLength: 2500 })
  @IsString()
  @MinLength(1)
  @MaxLength(2500)
  prompt: string;

  @ApiProperty({ description: 'Start frame — HTTPS URL or base64 data URI (data:image/...;base64,...)' })
  @IsUrlOrBase64()
  image_url: string;

  @ApiProperty({ enum: VALID_MODEL_IDS, description: 'Kling model to use' })
  @IsIn(VALID_MODEL_IDS)
  model: KlingModelId;

  @ApiProperty({ enum: VALID_MODES, description: 'Generation mode: std (720p), pro (1080p), 4k (v3 only)' })
  @IsIn(VALID_MODES)
  mode: KlingMode;

  @ApiProperty({ enum: VALID_DURATIONS, description: 'Video duration — pass as string: "5", "10", or "15"' })
  @IsString()
  @IsIn(VALID_DURATIONS)
  duration: KlingDuration;

  @ApiProperty({ enum: VALID_ASPECT_RATIOS, description: 'Video aspect ratio' })
  @IsIn(VALID_ASPECT_RATIOS)
  aspect_ratio: KlingAspectRatio;

  @ApiProperty({ description: 'Enable AI-generated audio (requires kling-v3-omni)' })
  @IsBoolean()
  audio: boolean;

  @ApiPropertyOptional({ description: 'End frame — HTTPS URL or base64 data URI. Kling interpolates between start and end frames.' })
  @IsOptional()
  @IsUrlOrBase64()
  end_image_url?: string;

  @ApiPropertyOptional({ description: 'Style reference images (omni endpoint only) — HTTPS URLs or base64 data URIs', type: [String] })
  @IsOptional()
  style_refs?: string[];

  @ApiPropertyOptional({ description: 'Negative prompt', maxLength: 2500 })
  @IsOptional()
  @IsString()
  @MaxLength(2500)
  negative_prompt?: string;
}
