import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// a shared, mutually-visible timeline of moments — either person can add
// to it, unlike diary entries there's no per-author column gating anything
@Entity('memories')
export class Memory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // the date the moment actually happened, distinct from createdAt (when
  // it was added to the site) — lets old memories be added out of order
  @Column({ type: 'date', nullable: true })
  memoryDate: string;

  @Column({ nullable: true })
  photoUrl: string;

  // just the 11-char video ID, never the raw URL — normalized once at
  // write time so the frontend can build thumbnail/embed URLs from it
  // directly (https://img.youtube.com/vi/{id}/..., youtube.com/embed/{id})
  @Column({ nullable: true })
  youtubeId: string;

  @Column({ type: 'varchar', nullable: true })
  addedBy: 'me' | 'partner';

  @Column({ default: false })
  liked: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
