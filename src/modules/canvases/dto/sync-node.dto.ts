import {
    IsArray,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncNodeItemDto {
    @ApiProperty({ description: 'Frontend node ID (e.g. timestamp string)' })
    @IsString()
    id: string;

    @ApiProperty()
    @IsNumber()
    x: number;

    @ApiProperty()
    @IsNumber()
    y: number;

    @ApiPropertyOptional({ default: 360 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    width?: number;

    @ApiPropertyOptional({ default: 240 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    height?: number;

    @ApiPropertyOptional({ description: 'Node type: QuestionNode, ResponseNode, ImageNode, etc.' })
    @IsOptional()
    @IsString()
    type?: string;

    @ApiPropertyOptional({ description: 'Full node data (label, prompt, ask, config, etc.)' })
    @IsOptional()
    @IsObject()
    data?: Record<string, unknown>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    zIndex?: number;
}

export class SyncEdgeItemDto {
    @ApiProperty({ description: 'Frontend source node ID' })
    @IsString()
    source: string;

    @ApiProperty({ description: 'Frontend target node ID' })
    @IsString()
    target: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsObject()
    metadata?: Record<string, unknown>;
}

export class SyncCanvasDto {
    @ApiProperty({ type: [SyncNodeItemDto], description: 'Nodes to sync (upsert by id)' })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncNodeItemDto)
    nodes: SyncNodeItemDto[];

    @ApiProperty({ type: [SyncEdgeItemDto], description: 'Edges to sync' })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncEdgeItemDto)
    edges: SyncEdgeItemDto[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    viewportX?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    viewportY?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    viewportZoom?: number;
}
