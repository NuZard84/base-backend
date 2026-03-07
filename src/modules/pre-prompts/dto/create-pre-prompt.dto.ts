import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePrePromptDto {
  @ApiProperty({ example: 'Data Analyst' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    example:
      'You are a professional data analyst. Provide insights using structured analysis.',
  })
  @IsString()
  prompt: string;

  @ApiProperty({ example: 'system', enum: ['system', 'user', 'feature'] })
  @IsOptional()
  @IsIn(['system', 'user', 'feature'])
  type?: 'system' | 'user' | 'feature';
}
