import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
    @ApiProperty({ description: '256-bit hex reset token from password reset email' })
    @IsString()
    @IsNotEmpty()
    token: string;

    @ApiProperty({ example: 'MyNewSecureP@ss1', minLength: 8, maxLength: 128 })
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    password: string;
}
