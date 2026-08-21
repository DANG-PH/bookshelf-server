import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const READ_STATUSES = ['want', 'reading', 'done'] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];
const RATINGS = [1, 2, 3, 4, 5] as const;

// deliberately separate from UpdateBookDto: this is the stuff anyone
// browsing the site (not just whoever's adding books) is allowed to change,
// so it stays a tiny plain-JSON endpoint with no file handling involved
export class UpdateBookStatusDto {
  @ApiPropertyOptional({
    enum: [...READ_STATUSES, null],
    description: 'Trạng thái đọc, gửi null để bỏ trạng thái',
  })
  @IsOptional()
  @IsIn([...READ_STATUSES, null])
  readStatus?: ReadStatus | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @ApiPropertyOptional({
    enum: [...RATINGS, null],
    description: 'Đánh giá sao (1–5), gửi null để bỏ đánh giá',
  })
  @IsOptional()
  @IsIn([...RATINGS, null])
  rating?: number | null;

  @ApiPropertyOptional({
    description: 'Cảm nhận cá nhân sau khi đọc, gửi null để xoá',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  review?: string | null;
}
