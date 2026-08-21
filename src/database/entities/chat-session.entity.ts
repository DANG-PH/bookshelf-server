import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// one row per conversation thread — shared across both people (no
// per-user rows, same as Notification), so either person can pick up
// or delete any conversation. title is set from the first message once
// there is one; updatedAt is touched on every new message so the
// session list can sort by "most recently active" like a real chat app
@Entity('chat_sessions')
export class ChatSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  title: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
