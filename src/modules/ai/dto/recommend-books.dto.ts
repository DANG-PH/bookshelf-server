import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class RecommendBooksDto {
  @ApiPropertyOptional({
    description:
      'ID cuộc trò chuyện để gắn gợi ý vào — bỏ trống để tạo cuộc trò chuyện mới',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
