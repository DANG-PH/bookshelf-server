import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookQuote } from './book-quote.entity';
import { BookReview } from './book-review.entity';
import { Category } from './category.entity';

@Entity('books')
export class Book {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Category, (category) => category.books, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'categoryId' })
  category: Category;

  @Column()
  categoryId: string;

  @Column({ nullable: true })
  num: string;

  @Column({ type: 'int', nullable: true })
  year: number;

  @Column()
  title: string;

  @Column({ nullable: true })
  author: string;

  @Column({ type: 'text', nullable: true })
  blurb: string;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  // path served through GET /api/files/books/:filename
  @Column()
  fileUrl: string;

  @Column({ nullable: true })
  fileOriginalName: string;

  // optional Vietnamese translation of the same PDF, uploaded separately
  // (produced outside this app — see docs/vi-translate.md) — the reader
  // gets a second "Đọc bản dịch" link on the card when this is set,
  // never a requirement, just an extra alongside the original file
  // explicit type: 'varchar' — a `string | null` TS union reflects as
  // "Object" in emitDecoratorMetadata (unions can't be represented as a
  // single runtime type), and TypeORM infers the column type from exactly
  // that metadata when none is given, so this is required, not decorative.
  // Confirmed the hard way: without it, Postgres rejects it with
  // "Data type Object ... is not supported" on every app start.
  @Column({ type: 'varchar', nullable: true })
  translatedFileUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  translatedFileOriginalName: string | null;

  // auto-detected from the book's own PDF text the moment it's added
  // (see BooksService/detect-language.ts) — 'vi' | 'foreign' | null
  // (null = couldn't tell, e.g. a scanned PDF with no text layer).
  // Exists so "does this book even need a translation" never depends on
  // someone remembering to judge it by hand — see docs/vi-translate.md
  @Column({ type: 'varchar', nullable: true })
  detectedLanguage: 'vi' | 'foreign' | null;

  // state of the automated translation job — see TranslationQueueService.
  // null: never queued. 'queued': waiting for a worker slot (only one
  // book translates at a time). 'processing': the PDF translator service
  // is working on it right now. 'done': translatedFileUrl above is the
  // result — once here, the auto-translate trigger is retired for this
  // book for good (re-translating is a deliberate manual re-upload, not
  // something the automated path repeats). 'failed': errored out,
  // translationJobError has why, and admin can retry (re-queue).
  @Column({ type: 'varchar', nullable: true })
  translationJobStatus: 'queued' | 'processing' | 'done' | 'failed' | null;

  @Column({ type: 'text', nullable: true })
  translationJobError: string | null;

  // either a path served through GET /api/files/covers/:filename,
  // or an external http(s) URL — resolved as-is by the frontend
  @Column({ nullable: true })
  coverUrl: string;

  // a short personal note from whoever added the book ("mình chọn cuốn
  // này vì...") — set once at add-time, shown on the card
  @Column({ type: 'text', nullable: true })
  note: string;

  // 'want' | 'reading' | 'done' | null — set by whoever's browsing the
  // site, plain varchar (not a DB enum) so it stays portable across
  // postgres/mysql and easy to extend later without a schema migration
  @Column({ type: 'varchar', nullable: true })
  readStatus: string | null;

  // set/cleared by BooksService.updateStatus() alongside readStatus —
  // lets "reading stats" and the "đọc dở lâu rồi" nudge be based on real
  // timestamps instead of guessing from updatedAt (which changes on any
  // edit, not just a status change)
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  // which of the two people have favorited this — per-author, same
  // reasoning as DiaryEntry.likedBy: one person's heart shouldn't
  // silently overwrite the other's
  @Column({ type: 'simple-array', nullable: true })
  favoritedBy: ('me' | 'partner')[];

  // bumped by POST /books/:id/view whenever someone opens the file —
  // purely a lightweight "đã xem N lần" badge, not an analytics system
  @Column({ type: 'int', default: 0 })
  viewCount: number;

  // each person's own rating + review lives in a separate row (see
  // BookReview) instead of a single shared column — one person rating
  // a book shouldn't overwrite the other's opinion of it
  @OneToMany(() => BookReview, (r) => r.book)
  reviews: BookReview[];

  // memorable passages saved while reading — plain text, no author (a
  // quote is the book's own words, not anyone's opinion), any number
  // per book
  @OneToMany(() => BookQuote, (q) => q.book)
  quotes: BookQuote[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
