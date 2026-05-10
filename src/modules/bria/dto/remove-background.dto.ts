import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemoveBackgroundDto {
  @ApiProperty({
    description: 'Publicly accessible image URL (JPEG, PNG, WEBP) or base64 data URL',
    example: 'https://example.com/photo.jpg',
  })
  @IsString()
  @IsNotEmpty()
  image: string;
}
