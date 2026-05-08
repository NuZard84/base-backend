import { IsIn, IsBoolean, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  VALID_MODEL_IDS,
  VALID_MODES,
  VALID_DURATIONS,
  type KlingModelId,
  type KlingMode,
  type KlingDuration,
} from '../constants/kling-models';

export class CostEstimateQueryDto {
  @ApiProperty({ enum: VALID_MODEL_IDS })
  @IsIn(VALID_MODEL_IDS)
  model: KlingModelId;

  @ApiProperty({ enum: VALID_MODES })
  @IsIn(VALID_MODES)
  mode: KlingMode;

  @ApiProperty({ enum: VALID_DURATIONS, description: 'Duration as string: "5", "10", or "15"' })
  @IsString()
  @IsIn(VALID_DURATIONS)
  duration: KlingDuration;

  @ApiProperty({ description: '"true" or "false"' })
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  audio: boolean;
}
