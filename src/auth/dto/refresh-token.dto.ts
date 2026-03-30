import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description: 'Refresh token (only needed for non-browser clients; browsers use httpOnly cookie)',
    example: 'your_refresh_token_here',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
