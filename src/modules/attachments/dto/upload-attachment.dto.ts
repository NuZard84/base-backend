import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadAttachmentDto {
    @ApiPropertyOptional({
        description: 'Entity type for association (e.g. "canvas", "node")',
        example: 'canvas',
    })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    entityType?: string;

    @ApiPropertyOptional({
        description: 'Entity ID for association',
        example: '550e8400-e29b-41d4-a716-446655440000',
    })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    entityId?: string;
}
