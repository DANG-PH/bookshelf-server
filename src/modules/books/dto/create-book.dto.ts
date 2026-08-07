import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
} from 'class-validator';

// arrives as multipart/form-data — every field lands as a string, so
// numbers/booleans/arrays are coerced explicitly with @Transform
export class CreateBookDto {
  @ApiProperty()
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({
    description: 'Số thứ tự trong ngăn, để trống sẽ tự sinh',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  num?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value == null ? undefined : Number(value),
  )
  @IsInt()
  year?: number;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  blurb?: string;

  @ApiPropertyOptional({
    description: 'Danh sách tag, phân tách bởi dấu phẩy',
    example: 'BE,DE,SA',
  })
  @IsOptional()
  @Transform(({ value }): string[] | undefined => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    return value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  })
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Ảnh bìa dạng URL ngoài — bỏ qua nếu có upload file cover',
  })
  @IsOptional()
  @IsUrl()
  coverUrl?: string;

  @ApiPropertyOptional({
    description:
      'Link tới file PDF có sẵn — server sẽ tải về thay vì phải upload thủ công. Bỏ qua nếu có upload file.',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  pdfUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isNew?: boolean;
}
