import { IsArray, IsNumber, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ViewportQueryDto {
    @ApiPropertyOptional({ description: 'Viewport min X for spatial fetch' })
    @IsOptional()
    @Transform(({ value }) => (value === '' ? undefined : Number(value)))
    @IsNumber()
    minX?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Transform(({ value }) => (value === '' ? undefined : Number(value)))
    @IsNumber()
    minY?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Transform(({ value }) => (value === '' ? undefined : Number(value)))
    @IsNumber()
    maxX?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Transform(({ value }) => (value === '' ? undefined : Number(value)))
    @IsNumber()
    maxY?: number;

    @ApiPropertyOptional({ description: 'Tile IDs for tile-based fetch (e.g. 1,2,3)' })
    @IsOptional()
    @Transform(({ value }) => {
        if (value == null) return undefined;
        const arr = Array.isArray(value) ? value : String(value).split(',');
        return arr.map((v: string) => parseInt(String(v).trim(), 10)).filter((n) => !Number.isNaN(n));
    })
    @IsArray()
    @IsNumber({}, { each: true })
    tileIds?: number[];
}
