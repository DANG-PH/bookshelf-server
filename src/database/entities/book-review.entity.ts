import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Book } from './book.entity';

export type BookReviewAuthor = 'me' | 'partner';

// one row per submission, not per (book, author) — either person can
// write as many ratings/reviews for the same book as they want over time
// (re-reads, updated thoughts, …) instead of one entry silently
// overwriting the last
@Entity('book_reviews')
export class BookReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Book, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bookId' })
  book: Book;

  @Column()
  bookId: string;

  @Column({ type: 'varchar' })
  author: BookReviewAuthor;

  @Column({ type: 'int', nullable: true })
  rating: number | null;

  @Column({ type: 'text', nullable: true })
  review: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
