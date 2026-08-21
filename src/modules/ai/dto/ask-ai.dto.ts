import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AskAiDto {
  @ApiProperty({ description: 'Câu hỏi gửi cho chatbot thư viện' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({
    description:
      'ID cuộc trò chuyện đang tiếp tục — bỏ trống để bắt đầu cuộc trò chuyện mới. Lịch sử được lấy từ DB theo id này, không phải do client tự gửi lên.',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
