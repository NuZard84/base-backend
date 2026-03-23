import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryAttachmentsDto {
    @ApiPropertyOptional({
        description: 'Filter by entity type',
        example: 'canvas',
    })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    entityType?: string;

    @ApiPropertyOptional({
        description: 'Filter by entity ID',
        example: '550e8400-e29b-41d4-a716-446655440000',
    })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    entityId?: string;
}
