import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
    @ApiProperty({ description: 'Comment body (markdown allowed)', minLength: 1, maxLength: 4000 })
    @IsString()
    @MinLength(1)
    @MaxLength(4000)
    body!: string;

    @ApiProperty({ description: 'X coordinate in canvas space' })
    @IsNumber()
    x!: number;

    @ApiProperty({ description: 'Y coordinate in canvas space' })
    @IsNumber()
    y!: number;

    @ApiPropertyOptional({ description: 'Optional node id this pin is anchored to' })
    @IsOptional()
    @IsUUID()
    anchorNodeId?: string;
}
