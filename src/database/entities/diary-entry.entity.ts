import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 'me' = the curator (curatorName in SiteSetting), 'partner' = the other
// person (partnerName) — stable keys so renaming either person in Settings
// never orphans old entries
export type DiaryAuthor = 'me' | 'partner';

@Entity('diary_entries')
export class DiaryEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  author: DiaryAuthor;

  @Column({ nullable: true })
  title: string;

  @Column({ type: 'text' })
  content: string;

  // free-form short tag: "vui" | "buon" | "nho" | "yeu" | "gian" | ... —
  // varchar not a DB enum, so adding a new mood later needs no migration
  @Column({ type: 'varchar', nullable: true })
  mood: string;

  // which of the two people have hearted this entry — tracked per-author
  // (not a single shared flag) so one person's tym can't silently un-heart
  // the other's; the frontend counts array length for the "x tym" badge
  @Column({ type: 'simple-array', nullable: true })
  likedBy: DiaryAuthor[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
