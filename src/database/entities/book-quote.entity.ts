import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Book } from './book.entity';

// a saved excerpt from the book itself — no author field, unlike
// BookReview: a quote is the book's own words, not either person's
// opinion, so there's nothing to attribute
@Entity('book_quotes')
export class BookQuote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Book, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bookId' })
  book: Book;

  @Column()
  bookId: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'int', nullable: true })
  page: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
