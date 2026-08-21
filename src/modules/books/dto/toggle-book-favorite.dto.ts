import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const BOOK_AUTHORS = ['me', 'partner'] as const;

export class ToggleBookFavoriteDto {
  @ApiProperty({
    enum: BOOK_AUTHORS,
    description:
      'Ai đang bấm tym — chỉ lượt yêu thích của người này được bật/tắt',
  })
  @IsIn(BOOK_AUTHORS)
  author: (typeof BOOK_AUTHORS)[number];
}
