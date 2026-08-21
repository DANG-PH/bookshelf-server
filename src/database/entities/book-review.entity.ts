import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Book } from './book.entity';

export type BookReviewAuthor = 'me' | 'partner';

// one row per (book, author) — each of the two people gets their own
// rating + review of a book instead of a single shared value either
// person could silently overwrite
@Entity('book_reviews')
@Unique(['bookId', 'author'])
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

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
