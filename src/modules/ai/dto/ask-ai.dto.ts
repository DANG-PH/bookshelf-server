import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AskAiDto {
  @ApiProperty({ description: 'Câu hỏi gửi cho chatbot thư viện' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message: string;
}
