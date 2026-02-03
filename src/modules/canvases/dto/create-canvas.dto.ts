import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCanvasDto {
    @ApiProperty({ required: false })
    @IsOptional()
    @IsNumber()
    viewportX?: number;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsNumber()
    viewportY?: number;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    description?: string;
}
