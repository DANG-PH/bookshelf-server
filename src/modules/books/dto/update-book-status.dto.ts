import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const READ_STATUSES = ['want', 'reading', 'done'] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];

// deliberately separate from UpdateBookDto: this is the stuff anyone
// browsing the site (not just whoever's adding books) is allowed to change,
// so it stays a tiny plain-JSON endpoint with no file handling involved.
// Favoriting and rating/review moved to their own per-author endpoints
// (PATCH :id/favorite, PUT :id/reviews) — readStatus stays here since
// it's still a single shared value, not something asked to split apart.
export class UpdateBookStatusDto {
  @ApiPropertyOptional({
    enum: [...READ_STATUSES, null],
    description: 'Trạng thái đọc, gửi null để bỏ trạng thái',
  })
  @IsOptional()
  @IsIn([...READ_STATUSES, null])
  readStatus?: ReadStatus | null;
}
