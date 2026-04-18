import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
    @ApiProperty({ description: '256-bit hex verification token from email link' })
    @IsString()
    @IsNotEmpty()
    token: string;
}
