import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DiaryAuthor,
  DiaryEntry,
} from '../../database/entities/diary-entry.entity';
import { CreateDiaryEntryDto } from './dto/create-diary-entry.dto';
import { QueryDiaryDto } from './dto/query-diary.dto';
import { UpdateDiaryEntryDto } from './dto/update-diary-entry.dto';

export interface PaginatedDiaryEntries {
  items: DiaryEntry[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class DiaryService {
  constructor(
    @InjectRepository(DiaryEntry)
    private readonly diaryRepo: Repository<DiaryEntry>,
  ) {}

  async findAll(query: QueryDiaryDto): Promise<PaginatedDiaryEntries> {
    const limit = query.limit ?? 30;
    const offset = query.offset ?? 0;

    const qb = this.diaryRepo
      .createQueryBuilder('entry')
      .orderBy('entry.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    if (query.author) {
      qb.andWhere('entry.author = :author', { author: query.author });
    }
    if (query.startDate) {
      qb.andWhere('entry.createdAt >= :startDate', {
        startDate: `${query.startDate} 00:00:00`,
      });
    }
    if (query.endDate) {
      qb.andWhere('entry.createdAt <= :endDate', {
        endDate: `${query.endDate} 23:59:59`,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, limit, offset };
  }

  create(dto: CreateDiaryEntryDto): Promise<DiaryEntry> {
    const entry = this.diaryRepo.create(dto);
    return this.diaryRepo.save(entry);
  }

  async update(id: string, dto: UpdateDiaryEntryDto): Promise<DiaryEntry> {
    const entry = await this.findOne(id);
    Object.assign(entry, dto);
    return this.diaryRepo.save(entry);
  }

  async toggleLike(id: string, author: DiaryAuthor): Promise<DiaryEntry> {
    const entry = await this.findOne(id);
    const likedBy = new Set(entry.likedBy || []);
    if (likedBy.has(author)) likedBy.delete(author);
    else likedBy.add(author);
    entry.likedBy = [...likedBy];
    return this.diaryRepo.save(entry);
  }

  async remove(id: string): Promise<void> {
    const entry = await this.findOne(id);
    await this.diaryRepo.remove(entry);
  }

  private async findOne(id: string): Promise<DiaryEntry> {
    const entry = await this.diaryRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Không tìm thấy dòng nhật ký');
    return entry;
  }
}
