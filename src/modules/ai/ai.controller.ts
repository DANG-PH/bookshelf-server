import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AskAiDto } from './dto/ask-ai.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('ask')
  @ApiOperation({ summary: 'Hỏi chatbot về các sách trong thư viện (RAG)' })
  ask(@Body() dto: AskAiDto) {
    return this.aiService.chatCompletion(dto.message);
  }

  @Get('status')
  @ApiOperation({
    summary:
      'Chẩn đoán trạng thái index RAG (đã bật chưa, đã đánh index bao nhiêu sách/đoạn, lỗi gần nhất)',
  })
  status() {
    return this.aiService.getStatus();
  }
}
