import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class EraseImageDto {
  @ApiProperty({
    description: 'JSON array of [x,y] click points in original image pixels',
    example: '[[120,80],[300,200]]',
  })
  @IsString()
  points: string;

  @ApiProperty({ description: 'Mask dilation in pixels (default 15)', required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  @Type(() => Number)
  dilation_px?: number;

  /** Parse and validate the points JSON string. Throws on bad input. */
  parsedPoints(): [number, number][] {
    try {
      const arr = JSON.parse(this.points) as unknown;
      if (!Array.isArray(arr) || arr.length === 0) throw new Error();
      return (arr as [number, number][]).map(([x, y]) => [Number(x), Number(y)]);
    } catch {
      throw new Error(`Invalid points JSON: "${this.points}"`);
    }
  }
}
