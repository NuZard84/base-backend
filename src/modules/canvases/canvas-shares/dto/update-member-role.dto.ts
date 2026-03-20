import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CanvasRole } from '@prisma/client';

export class UpdateMemberRoleDto {
    @ApiProperty({ enum: CanvasRole })
    @IsEnum(CanvasRole)
    role: CanvasRole;
}
