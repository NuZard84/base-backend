import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'The refresh token obtained during login',
    example: 'your_refresh_token_here',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
