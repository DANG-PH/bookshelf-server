import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { ChatSession } from '../../database/entities/chat-session.entity';
import { ChatSessionsController } from './chat-sessions.controller';
import { ChatSessionsService } from './chat-sessions.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChatSession, ChatMessage])],
  controllers: [ChatSessionsController],
  providers: [ChatSessionsService],
  exports: [ChatSessionsService],
})
export class ChatSessionsModule {}
