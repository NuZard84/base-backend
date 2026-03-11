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

/**
 * Sync DTO supports two modes:
 * - FULL SYNC: nodes + edges present → full replace (fallback for initial load, recovery)
 * - DELTA SYNC: nodesUpdated | nodesDeleted | edgesAdded | edgesDeleted → touch only changed rows
 */
export class SyncCanvasDto {
    /** Full canvas nodes (required for full sync) */
    @ApiPropertyOptional({ type: [SyncNodeItemDto], description: 'Full nodes list (full sync only)' })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncNodeItemDto)
    nodes?: SyncNodeItemDto[];

    /** Full canvas edges (required for full sync) */
    @ApiPropertyOptional({ type: [SyncEdgeItemDto], description: 'Full edges list (full sync only)' })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncEdgeItemDto)
    edges?: SyncEdgeItemDto[];

    /** Nodes created or modified (delta sync) */
    @ApiPropertyOptional({ type: [SyncNodeItemDto], description: 'Nodes to upsert (delta sync)' })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncNodeItemDto)
    nodesUpdated?: SyncNodeItemDto[];

    /** Node clientIds to delete (delta sync) */
    @ApiPropertyOptional({ description: 'Node clientIds to remove (delta sync)' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    nodesDeleted?: string[];

    /** New edges to add (delta sync) */
    @ApiPropertyOptional({ type: [SyncEdgeItemDto], description: 'Edges to add (delta sync)' })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncEdgeItemDto)
    edgesAdded?: SyncEdgeItemDto[];

    /** Edge UUIDs to delete (delta sync) */
    @ApiPropertyOptional({ description: 'Edge IDs to remove (delta sync)' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    edgesDeleted?: string[];

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
