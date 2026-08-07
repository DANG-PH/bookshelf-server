import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
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

  @Column({ default: false })
  isFavorite: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
