import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Book } from '../../database/entities/book.entity';
import { DiaryEntry } from '../../database/entities/diary-entry.entity';
import { Memory } from '../../database/entities/memory.entity';

const RESULT_LIMIT = 5;

export interface SearchResults {
  books: Book[];
  diary: DiaryEntry[];
  memories: Memory[];
}

// one query box across everything instead of three separate ones per
// page. Diary is deliberately scoped to shared entries only — private
// diary entries must never surface through a "harmless" search feature
@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Book) private readonly booksRepo: Repository<Book>,
    @InjectRepository(DiaryEntry)
    private readonly diaryRepo: Repository<DiaryEntry>,
    @InjectRepository(Memory)
    private readonly memoriesRepo: Repository<Memory>,
  ) {}

  async search(q: string): Promise<SearchResults> {
    const pattern = `%${q}%`;
    const [books, diary, memories] = await Promise.all([
      this.booksRepo
        .createQueryBuilder('book')
        .where(
          '(book.title ILIKE :q OR book.author ILIKE :q OR book.blurb ILIKE :q)',
          { q: pattern },
        )
        .take(RESULT_LIMIT)
        .getMany(),
      this.diaryRepo
        .createQueryBuilder('entry')
        .where('entry.isPrivate = false')
        .andWhere('(entry.title ILIKE :q OR entry.content ILIKE :q)', {
          q: pattern,
        })
        .orderBy('entry.createdAt', 'DESC')
        .take(RESULT_LIMIT)
        .getMany(),
      this.memoriesRepo
        .createQueryBuilder('memory')
        .where('(memory.title ILIKE :q OR memory.description ILIKE :q)', {
          q: pattern,
        })
        .orderBy('COALESCE(memory.memoryDate, memory.createdAt)', 'DESC')
        .take(RESULT_LIMIT)
        .getMany(),
    ]);
    return { books, diary, memories };
  }
}
