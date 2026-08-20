import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DIARY_AUTHORS } from './create-diary-entry.dto';

// unlike QueryDiaryDto, author is required here — there's no "list
// everyone's private entries" mode, only "list this one person's own"
export class QueryPrivateDiaryDto {
  @ApiProperty({ enum: DIARY_AUTHORS })
  @IsIn(DIARY_AUTHORS)
  author: (typeof DIARY_AUTHORS)[number];

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

  @ApiPropertyOptional({ description: 'Tìm trong tiêu đề và nội dung' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
