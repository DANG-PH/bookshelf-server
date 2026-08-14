import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const DIARY_AUTHORS = ['me', 'partner'] as const;
export const DIARY_MOODS = [
  'vui',
  'buon',
  'nho',
  'yeu',
  'gian',
  'binh-yen',
] as const;

export class CreateDiaryEntryDto {
  @ApiProperty({ enum: DIARY_AUTHORS })
  @IsIn(DIARY_AUTHORS)
  author: (typeof DIARY_AUTHORS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({ enum: DIARY_MOODS })
  @IsOptional()
  @IsIn(DIARY_MOODS)
  mood?: string;
}
