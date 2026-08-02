import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'tech', description: 'Slug duy nhất, không dấu' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug chỉ gồm chữ thường, số và dấu gạch ngang',
  })
  @MaxLength(64)
  slug: string;

  @ApiProperty({ example: 'Công nghệ' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: '005' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  dewey?: string;

  @ApiPropertyOptional({ example: '000–099' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  range?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  intro?: string;

  @ApiPropertyOptional({ description: 'Thứ tự hiển thị, số nhỏ lên trước' })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
