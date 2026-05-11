import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class DetectTextDto {
  @ApiProperty({ description: 'Publicly accessible image URL (e.g. presigned S3)' })
  @IsString()
  imageUrl: string;
}
