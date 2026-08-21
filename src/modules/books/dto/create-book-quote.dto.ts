import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateBookQuoteDto {
  @ApiProperty({ description: 'Đoạn trích từ sách' })
  @IsString()
  @MaxLength(1000)
  text: string;

  @ApiPropertyOptional({ description: 'Số trang, không bắt buộc' })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;
}
