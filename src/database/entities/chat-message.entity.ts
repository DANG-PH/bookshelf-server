import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChatSession } from './chat-session.entity';

export type ChatRole = 'user' | 'model';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ChatSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: ChatSession;

  @Column()
  sessionId: string;

  @Column({ type: 'varchar' })
  role: ChatRole;

  @Column({ type: 'text' })
  text: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
