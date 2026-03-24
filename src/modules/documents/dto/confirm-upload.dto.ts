import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmUploadDto {
  @ApiProperty({ description: 'Document ID returned by POST /documents/presigned-url' })
  @IsString()
  documentId: string;

  @ApiPropertyOptional({ description: 'SHA-256 hex hash of the uploaded file (for deduplication)' })
  @IsOptional()
  @IsString()
  contentHash?: string;
}
