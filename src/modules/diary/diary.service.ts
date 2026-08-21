import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DiaryAuthor,
  DiaryEntry,
} from '../../database/entities/diary-entry.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { CreateDiaryEntryDto } from './dto/create-diary-entry.dto';
import { QueryDiaryDto } from './dto/query-diary.dto';
import { QueryPrivateDiaryDto } from './dto/query-private-diary.dto';
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
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
  ) {}

  async findAll(query: QueryDiaryDto): Promise<PaginatedDiaryEntries> {
    const limit = query.limit ?? 30;
    const offset = query.offset ?? 0;

    const qb = this.diaryRepo
      .createQueryBuilder('entry')
      // the shared feed never includes private entries, full stop —
      // there's no query param that can override this
      .where('entry.isPrivate = false')
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
    if (query.q) {
      qb.andWhere('(entry.title ILIKE :q OR entry.content ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, limit, offset };
  }

  async create(dto: CreateDiaryEntryDto): Promise<DiaryEntry> {
    const entry = this.diaryRepo.create(dto);
    const saved = await this.diaryRepo.save(entry);
    // never awaited — only the shared diary notifies (a private entry
    // must never surface who wrote it, or that anything was written at
    // all, to the other person)
    this.notifyNewEntry(saved).catch(() => undefined);
    return saved;
  }

  private async notifyNewEntry(entry: DiaryEntry): Promise<void> {
    const settings = await this.settingsService.get();
    const name =
      entry.author === 'me'
        ? settings.curatorName || 'Đăng'
        : settings.partnerName || 'Vy';
    await this.notificationsService.create(`${name} vừa thêm nhật ký mới`);
  }

  // "Nhật ký riêng" — each author's own space, never surfaced to the
  // other one. isPrivate is set here, not read from the client, so a
  // private entry can never be created any way other than through this
  async findAllPrivate(
    query: QueryPrivateDiaryDto,
  ): Promise<PaginatedDiaryEntries> {
    const limit = query.limit ?? 30;
    const offset = query.offset ?? 0;

    const qb = this.diaryRepo
      .createQueryBuilder('entry')
      .where('entry.isPrivate = true')
      .andWhere('entry.author = :author', { author: query.author })
      .orderBy('entry.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    if (query.q) {
      qb.andWhere('(entry.title ILIKE :q OR entry.content ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, limit, offset };
  }

  createPrivate(dto: CreateDiaryEntryDto): Promise<DiaryEntry> {
    const entry = this.diaryRepo.create({ ...dto, isPrivate: true });
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
