import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export const MEMORY_AUTHORS = ['me', 'partner'] as const;

export class CreateMemoryDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  memoryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  @ApiPropertyOptional({
    description: 'Link YouTube hoặc video ID — server tự tách lấy ID',
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  youtubeUrl?: string;

  @ApiPropertyOptional({ enum: MEMORY_AUTHORS })
  @IsOptional()
  @IsIn(MEMORY_AUTHORS)
  addedBy?: (typeof MEMORY_AUTHORS)[number];
}
