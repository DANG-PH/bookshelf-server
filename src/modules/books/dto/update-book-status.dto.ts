import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export const READ_STATUSES = ['want', 'reading', 'done'] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];

// deliberately separate from UpdateBookDto: this is the one thing anyone
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
}
