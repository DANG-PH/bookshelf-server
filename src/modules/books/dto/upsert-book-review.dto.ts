import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BOOK_AUTHORS } from './toggle-book-favorite.dto';

const RATINGS = [1, 2, 3, 4, 5] as const;

// upserts the caller's OWN rating/review — sending both rating and
// review empty deletes that person's review row entirely
export class UpsertBookReviewDto {
  @ApiProperty({ enum: BOOK_AUTHORS })
  @IsIn(BOOK_AUTHORS)
  author: (typeof BOOK_AUTHORS)[number];

  @ApiPropertyOptional({
    enum: [...RATINGS, null],
    description: 'Đánh giá sao (1–5), gửi null để bỏ',
  })
  @IsOptional()
  @IsIn([...RATINGS, null])
  rating?: number | null;

  @ApiPropertyOptional({ description: 'Cảm nhận cá nhân, gửi null để xoá' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  review?: string | null;
}
