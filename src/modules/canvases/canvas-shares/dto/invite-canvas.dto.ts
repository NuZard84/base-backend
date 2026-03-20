import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CanvasRole } from '@prisma/client';

export class InviteCanvasDto {
    @ApiProperty({ example: 'collaborator@example.com' })
    @IsEmail()
    email: string;

    @ApiPropertyOptional({ enum: CanvasRole, default: CanvasRole.EDITOR })
    @IsOptional()
    @IsEnum(CanvasRole)
    role?: CanvasRole;
}
