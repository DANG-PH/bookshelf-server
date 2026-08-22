import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReminderState } from '../../database/entities/reminder-state.entity';
import { BooksService } from '../books/books.service';
import { DiaryService } from '../diary/diary.service';
import { MemoriesService } from '../memories/memories.service';
import { NotificationsService } from '../notifications/notifications.service';

const STALLED_DAYS = 30;
const STALLED_COOLDOWN_DAYS = 7;
const QUIET_DIARY_DAYS = 7;
const QUIET_DIARY_COOLDOWN_DAYS = 7;
const QUOTE_COOLDOWN_DAYS = 5;
const STATE_ID = 1;

// a once-a-day "is there anything worth mentioning" check, not a fixed
// notification schedule — checked in priority order, sends at most ONE
// notification per run (never stacks multiple), and stays completely
// silent on a day none of the conditions apply. Each type below has its
// own cooldown so a condition that stays true for weeks (a stalled
// book, a quiet diary) doesn't turn into a daily nag once it fires —
// the balance the "thêm sách/nhật ký" event notifications alone were
// too sparse to provide, without tipping into too many either.
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectRepository(ReminderState)
    private readonly stateRepo: Repository<ReminderState>,
    private readonly booksService: BooksService,
    private readonly diaryService: DiaryService,
    private readonly memoriesService: MemoriesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // 20:00 Vietnam time — evening, when glancing at the phone casually is
  // more likely than during a work-hours ping
  @Cron('0 20 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async sendDailyReminder(): Promise<void> {
    try {
      if (await this.tryOnThisDay()) return;
      if (await this.tryStalledBook()) return;
      if (await this.tryQuietDiary()) return;
      await this.tryQuoteResurface();
    } catch (err) {
      this.logger.warn(`[Reminders] Lỗi khi chạy nhắc định kỳ: ${String(err)}`);
    }
  }

  private async getState(): Promise<ReminderState> {
    const existing = await this.stateRepo.findOne({ where: { id: STATE_ID } });
    if (existing) return existing;
    return this.stateRepo.save(this.stateRepo.create({ id: STATE_ID }));
  }

  private daysSince(date: Date | null | undefined): number {
    if (!date) return Infinity;
    return (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max).trim()}…` : text;
  }

  // "ngày này năm xưa" — highest priority: tied to today's actual date,
  // so it can never fire on a day it isn't genuinely relevant, unlike
  // the throttled ones below
  private async tryOnThisDay(): Promise<boolean> {
    const [diaryMatches, memoryMatches] = await Promise.all([
      this.diaryService.onThisDay(),
      this.memoriesService.onThisDay(),
    ]);
    const thisYear = new Date().getFullYear();

    if (diaryMatches.length) {
      const entry = diaryMatches[0];
      const yearsAgo = thisYear - entry.createdAt.getFullYear();
      const preview = this.truncate(entry.content, 80);
      await this.notificationsService.create(
        `✨ ${yearsAgo} năm trước hôm nay, có dòng nhật ký này: "${preview}"`,
      );
      return true;
    }
    if (memoryMatches.length) {
      const memory = memoryMatches[0];
      const basis = memory.memoryDate
        ? new Date(memory.memoryDate)
        : memory.createdAt;
      const yearsAgo = thisYear - basis.getFullYear();
      await this.notificationsService.create(
        `✨ ${yearsAgo} năm trước, có kỷ niệm "${memory.title}" đấy — còn nhớ không?`,
      );
      return true;
    }
    return false;
  }

  // "đọc dở lâu rồi" — same 30-day threshold as the frontend's own
  // stalled-books card, throttled to once a week so it doesn't repeat
  // daily for as long as the book stays untouched
  private async tryStalledBook(): Promise<boolean> {
    const state = await this.getState();
    if (this.daysSince(state.lastStalledBookAt) < STALLED_COOLDOWN_DAYS) {
      return false;
    }
    const stalled = await this.booksService.findStalledReading(STALLED_DAYS);
    if (!stalled.length) return false;
    const book = stalled[0];
    const daysReading = Math.floor(this.daysSince(book.startedAt));
    await this.notificationsService.create(
      `📖 "${book.title}" vẫn để "Đang đọc" ${daysReading} ngày rồi đó, đọc tiếp thôi!`,
    );
    state.lastStalledBookAt = new Date();
    await this.stateRepo.save(state);
    return true;
  }

  // "lâu rồi chưa viết nhật ký chung" — shared entries only, same as
  // onThisDay: a quiet private diary is nobody else's business to nudge
  private async tryQuietDiary(): Promise<boolean> {
    const state = await this.getState();
    if (this.daysSince(state.lastQuietDiaryAt) < QUIET_DIARY_COOLDOWN_DAYS) {
      return false;
    }
    const daysSinceLastEntry =
      await this.diaryService.daysSinceLastSharedEntry();
    if (daysSinceLastEntry === null || daysSinceLastEntry < QUIET_DIARY_DAYS) {
      return false;
    }
    await this.notificationsService.create(
      `✍️ Đã ${daysSinceLastEntry} ngày chưa có ai viết nhật ký chung rồi, viết vài dòng đi nhỉ?`,
    );
    state.lastQuietDiaryAt = new Date();
    await this.stateRepo.save(state);
    return true;
  }

  // "nhớ lại câu này" — purely for delight, lowest priority, only fires
  // if every more meaningful check above found nothing to say
  private async tryQuoteResurface(): Promise<boolean> {
    const state = await this.getState();
    if (this.daysSince(state.lastQuoteResurfaceAt) < QUOTE_COOLDOWN_DAYS) {
      return false;
    }
    const quote = await this.booksService.getRandomQuote();
    if (!quote) return false;
    await this.notificationsService.create(
      `❝ ${this.truncate(quote.text, 150)} ❞ — trích từ "${quote.bookTitle}"`,
    );
    state.lastQuoteResurfaceAt = new Date();
    await this.stateRepo.save(state);
    return true;
  }
}
