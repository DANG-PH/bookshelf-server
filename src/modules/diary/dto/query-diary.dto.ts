import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { DIARY_AUTHORS } from './create-diary-entry.dto';

export class QueryDiaryDto {
  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value == null ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value == null ? undefined : Number(value),
  )
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Lọc từ ngày (bao gồm)',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description: 'Lọc đến ngày (bao gồm)',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: DIARY_AUTHORS })
  @IsOptional()
  @IsIn(DIARY_AUTHORS)
  author?: (typeof DIARY_AUTHORS)[number];
}
