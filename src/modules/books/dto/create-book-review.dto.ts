import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BOOK_AUTHORS } from './toggle-book-favorite.dto';

const RATINGS = [1, 2, 3, 4, 5] as const;

// adds a NEW rating/review entry — does not touch or replace any of the
// author's earlier entries for this book (see BookReview)
export class CreateBookReviewDto {
  @ApiProperty({ enum: BOOK_AUTHORS })
  @IsIn(BOOK_AUTHORS)
  author: (typeof BOOK_AUTHORS)[number];

  @ApiPropertyOptional({
    enum: RATINGS,
    description: 'Đánh giá sao (1–5)',
  })
  @IsOptional()
  @IsIn(RATINGS)
  rating?: number;

  @ApiPropertyOptional({ description: 'Cảm nhận cá nhân' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  review?: string;
}
