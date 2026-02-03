import { IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RenameCanvasDto {
    @ApiProperty({ required: true })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    description?: string;
}
