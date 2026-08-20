import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// one row per diary author ('me' | 'partner') who has chosen to lock
// their column behind a personal password — a soft privacy layer on top
// of the shared site PIN (everyone already holding the site PIN could
// still reset this via admin.html), not a hardened per-user auth system
@Entity('author_locks')
export class AuthorLock {
  @PrimaryColumn()
  author: string;

  @Column()
  passwordHash: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
