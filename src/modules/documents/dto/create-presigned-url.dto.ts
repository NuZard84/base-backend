import { IsString, IsIn, IsInt, Min, Max, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/csv',
  'application/csv',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export class CreatePresignedUrlDto {
  @ApiProperty({ example: 'quarterly-report.pdf' })
  @IsString()
  filename: string;

  @ApiProperty({
    enum: ALLOWED_MIME_TYPES,
    example: 'application/pdf',
  })
  @IsString()
  @IsIn(ALLOWED_MIME_TYPES)
  mimeType: string;

  @ApiProperty({ description: 'File size in bytes', example: 204800 })
  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024) // 25 MB
  sizeBytes: number;

  @ApiPropertyOptional({ description: 'Optional canvas ID to associate the document with' })
  @IsOptional()
  @IsString()
  canvasId?: string;
}
