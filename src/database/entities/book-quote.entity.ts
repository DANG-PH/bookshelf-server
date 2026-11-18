import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Book } from './book.entity';

// a saved excerpt from the book itself — the book's own words, so there's
// no author to attribute
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
