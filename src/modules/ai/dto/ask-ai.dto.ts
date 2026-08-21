import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatHistoryTurnDto {
  @ApiProperty({ enum: ['user', 'model'] })
  @IsIn(['user', 'model'])
  role: 'user' | 'model';

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  text: string;
}

export class AskAiDto {
  @ApiProperty({ description: 'Câu hỏi gửi cho chatbot thư viện' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({
    type: [ChatHistoryTurnDto],
    description:
      'Vài lượt hỏi-đáp gần nhất trong cuộc trò chuyện (client tự giữ, gửi kèm mỗi lần) — để chatbot trả lời nối tiếp được ngữ cảnh câu hỏi trước',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ChatHistoryTurnDto)
  history?: ChatHistoryTurnDto[];
}
