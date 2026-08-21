import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ChatSessionsService } from './chat-sessions.service';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai/sessions')
export class ChatSessionsController {
  constructor(private readonly chatSessionsService: ChatSessionsService) {}

  @Get()
  list() {
    return this.chatSessionsService.listSessions();
  }

  @Post()
  create() {
    return this.chatSessionsService.createSession();
  }

  @Get(':id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string) {
    return this.chatSessionsService.getMessages(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.chatSessionsService.deleteSession(id);
  }
}
