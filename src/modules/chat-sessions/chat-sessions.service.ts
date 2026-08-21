import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ChatMessage,
  ChatRole,
} from '../../database/entities/chat-message.entity';
import { ChatSession } from '../../database/entities/chat-session.entity';

const TITLE_MAX_LEN = 80;
const HISTORY_LIMIT = 16;

// real conversation threads, like ChatGPT/Claude — not the single
// reused session the chat widget started with. Shared across both
// people (no per-user rows), stored in the DB instead of the browser
// so it's consistent no matter which device either person is on.
@Injectable()
export class ChatSessionsService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionsRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messagesRepo: Repository<ChatMessage>,
  ) {}

  listSessions(): Promise<ChatSession[]> {
    return this.sessionsRepo.find({ order: { updatedAt: 'DESC' } });
  }

  createSession(): Promise<ChatSession> {
    return this.sessionsRepo.save(this.sessionsRepo.create());
  }

  // returns null instead of throwing — used internally by AiService so a
  // stale/deleted sessionId from the client just quietly starts a new
  // conversation instead of failing the whole request
  findSession(id: string): Promise<ChatSession | null> {
    return this.sessionsRepo.findOne({ where: { id } });
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    await this.requireSession(sessionId);
    return this.messagesRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  // most recent turns, oldest-first — what actually gets sent to Gemini
  // as conversation context, capped so the prompt doesn't grow unbounded
  // as a session gets long
  async recentHistory(sessionId: string): Promise<ChatMessage[]> {
    const recent = await this.messagesRepo.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: HISTORY_LIMIT,
    });
    return recent.reverse();
  }

  appendMessage(
    sessionId: string,
    role: ChatRole,
    text: string,
  ): Promise<ChatMessage> {
    return this.messagesRepo.save(
      this.messagesRepo.create({ sessionId, role, text }),
    );
  }

  // sets the session's title from its first message (once, never
  // overwritten after) and bumps updatedAt so the session list sorts by
  // "most recently active" — called after every exchange
  async touchSession(sessionId: string, firstMessage?: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (!session.title && firstMessage) {
      session.title =
        firstMessage.length > TITLE_MAX_LEN
          ? `${firstMessage.slice(0, TITLE_MAX_LEN).trim()}…`
          : firstMessage;
    }
    await this.sessionsRepo.save(session);
  }

  async deleteSession(id: string): Promise<void> {
    await this.requireSession(id);
    await this.sessionsRepo.delete({ id });
  }

  private async requireSession(id: string): Promise<ChatSession> {
    const session = await this.sessionsRepo.findOne({ where: { id } });
    if (!session) throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    return session;
  }
}
