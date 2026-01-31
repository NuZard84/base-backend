import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserDto {
    @ApiProperty({
        description: 'The name of the user',
        example: 'John Doe',
        required: false,
    })
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    name?: string;

    @ApiProperty({
        description: 'The profile image URL of the user',
        example: 'https://example.com/image.png',
        required: false,
    })
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    image?: string;
}
