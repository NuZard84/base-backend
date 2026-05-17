import { IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCommentDto {
    @ApiPropertyOptional({ description: 'Edited comment body' })
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(4000)
    body?: string;

    @ApiPropertyOptional({ description: 'New X coordinate (drag-to-reposition)' })
    @IsOptional()
    @IsNumber()
    x?: number;

    @ApiPropertyOptional({ description: 'New Y coordinate (drag-to-reposition)' })
    @IsOptional()
    @IsNumber()
    y?: number;
}

export class CreateReplyDto {
    @ApiPropertyOptional({ description: 'Reply body' })
    @IsString()
    @MinLength(1)
    @MaxLength(4000)
    body!: string;
}

export class UpdateReplyDto {
    @IsString()
    @MinLength(1)
    @MaxLength(4000)
    body!: string;
}
