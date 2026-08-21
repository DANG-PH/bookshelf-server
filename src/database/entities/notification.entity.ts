import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// shared across both people, not per-user — this is a 2-person site
// behind one PIN, so "who's seen what" is tracked per-notification
// (read boolean), not per-viewer
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ default: false })
  read: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
