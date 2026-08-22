import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Book } from '../../database/entities/book.entity';
import { BookQuote } from '../../database/entities/book-quote.entity';
import {
  BookReview,
  BookReviewAuthor,
} from '../../database/entities/book-review.entity';
import { MAX_PDF_SIZE_BYTES } from '../../common/utils/storage';
import { AiService } from '../ai/ai.service';
import { CategoriesService } from '../categories/categories.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { UpdateBookStatusDto } from './dto/update-book-status.dto';
import { CreateBookReviewDto } from './dto/create-book-review.dto';
import { CreateBookQuoteDto } from './dto/create-book-quote.dto';

export interface UploadedBookFiles {
  file?: Express.Multer.File[];
  cover?: Express.Multer.File[];
}

interface ResolvedBookFile {
  fileUrl: string;
  fileOriginalName?: string;
}

const DOWNLOAD_TIMEOUT_MS = 20_000;
const PDF_MAGIC_BYTES = '%PDF-';

@Injectable()
export class BooksService {
  private readonly uploadDir: string;

  constructor(
    @InjectRepository(Book)
    private readonly booksRepo: Repository<Book>,
    @InjectRepository(BookReview)
    private readonly bookReviewsRepo: Repository<BookReview>,
    @InjectRepository(BookQuote)
    private readonly bookQuotesRepo: Repository<BookQuote>,
    private readonly categoriesService: CategoriesService,
    private readonly config: ConfigService,
    private readonly aiService: AiService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR', './uploads');
  }

  findAll(categoryId?: string): Promise<Book[]> {
    return this.booksRepo.find({
      where: categoryId ? { categoryId } : {},
      order: { createdAt: 'ASC' },
      relations: { category: true, reviews: true, quotes: true },
    });
  }

  // used by RemindersService's "đọc dở lâu rồi" nudge — same threshold
  // and same startedAt-based logic as the frontend's own stalled-books
  // card, just queryable server-side for the cron job
  async findStalledReading(days: number): Promise<Book[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.booksRepo
      .createQueryBuilder('book')
      .where('book.readStatus = :status', { status: 'reading' })
      .andWhere('book.startedAt IS NOT NULL')
      .andWhere('book.startedAt <= :cutoff', { cutoff })
      .orderBy('book.startedAt', 'ASC')
      .getMany();
  }

  // used by RemindersService's occasional "nhớ lại câu này" nudge —
  // picks uniformly at random across all saved quotes, not just recent
  // ones, so an old favorite has just as much chance to resurface.
  // Random-offset-in-app instead of ORDER BY RANDOM()/RAND(): those are
  // spelled differently on postgres vs mysql, and this stays portable
  // without needing to branch on DB_TYPE (fine perf-wise too — this is
  // a personal library's worth of quotes, not a large table)
  async getRandomQuote(): Promise<{ bookTitle: string; text: string } | null> {
    const count = await this.bookQuotesRepo.count();
    if (count === 0) return null;
    const offset = Math.floor(Math.random() * count);
    const [quote] = await this.bookQuotesRepo.find({
      relations: { book: true },
      skip: offset,
      take: 1,
    });
    if (!quote) return null;
    return { bookTitle: quote.book.title, text: quote.text };
  }

  async findOne(id: string): Promise<Book> {
    const book = await this.booksRepo.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!book) throw new NotFoundException('Không tìm thấy sách');
    return book;
  }

  // per-author, same reasoning as DiaryEntry.likedBy — one person's
  // heart shouldn't silently overwrite the other's
  async toggleFavorite(id: string, author: BookReviewAuthor): Promise<Book> {
    const book = await this.findOne(id);
    const set = new Set(book.favoritedBy || []);
    if (set.has(author)) set.delete(author);
    else set.add(author);
    book.favoritedBy = [...set];
    return this.booksRepo.save(book);
  }

  // always adds a brand new entry — a person can rate/review the same
  // book as many times as they want (re-reads, updated thoughts, …)
  // instead of one submission overwriting the last
  async addReview(
    bookId: string,
    dto: CreateBookReviewDto,
  ): Promise<BookReview> {
    await this.findOne(bookId); // 404s if the book doesn't exist

    const hasContent = dto.rating != null || Boolean(dto.review?.trim());
    if (!hasContent) {
      throw new BadRequestException('Cần có sao hoặc cảm nhận');
    }

    const entity = this.bookReviewsRepo.create({
      bookId,
      author: dto.author,
      rating: dto.rating ?? null,
      review: dto.review?.trim() || null,
    });
    return this.bookReviewsRepo.save(entity);
  }

  async deleteReview(bookId: string, reviewId: string): Promise<void> {
    const review = await this.bookReviewsRepo.findOne({
      where: { id: reviewId, bookId },
    });
    if (!review) throw new NotFoundException('Không tìm thấy đánh giá');
    await this.bookReviewsRepo.remove(review);
  }

  // no author on a quote — it's the book's own words, not either
  // person's opinion — so unlike reviews there's no "whose entry is
  // this" to gate deletion behind; either person can remove any of them
  async addQuote(bookId: string, dto: CreateBookQuoteDto): Promise<BookQuote> {
    await this.findOne(bookId); // 404s if the book doesn't exist
    const entity = this.bookQuotesRepo.create({
      bookId,
      text: dto.text.trim(),
      page: dto.page ?? null,
    });
    return this.bookQuotesRepo.save(entity);
  }

  async deleteQuote(bookId: string, quoteId: string): Promise<void> {
    const quote = await this.bookQuotesRepo.findOne({
      where: { id: quoteId, bookId },
    });
    if (!quote) throw new NotFoundException('Không tìm thấy trích dẫn');
    await this.bookQuotesRepo.remove(quote);
  }

  async create(dto: CreateBookDto, files: UploadedBookFiles): Promise<Book> {
    const resolvedFile = await this.resolveBookFile(files, dto);
    if (!resolvedFile) {
      throw new BadRequestException(
        'Thiếu file PDF của sách — upload file hoặc dán link PDF',
      );
    }

    await this.categoriesService.findOne(dto.categoryId);

    const book = this.booksRepo.create({
      categoryId: dto.categoryId,
      num: dto.num ?? (await this.nextNum(dto.categoryId)),
      year: dto.year,
      title: dto.title,
      author: dto.author,
      blurb: dto.blurb,
      note: dto.note,
      tags: dto.tags,
      fileUrl: resolvedFile.fileUrl,
      fileOriginalName: resolvedFile.fileOriginalName,
      coverUrl: this.resolveCoverUrl(files, dto),
    });

    const saved = await this.booksRepo.save(book);
    // neither of these is awaited — indexing and logging a notification
    // shouldn't hold up the response for whoever's adding the book
    this.aiService.indexBookInBackground(saved);
    this.notificationsService
      .create(`Đã thêm sách mới: "${saved.title}"`)
      .catch(() => undefined);
    return saved;
  }

  async update(
    id: string,
    dto: UpdateBookDto,
    files: UploadedBookFiles,
  ): Promise<Book> {
    const book = await this.findOne(id);

    if (dto.categoryId && dto.categoryId !== book.categoryId) {
      await this.categoriesService.findOne(dto.categoryId);
    }

    const resolvedFile = await this.resolveBookFile(files, dto);
    const oldFileUrl = book.fileUrl;
    const newCoverUrl = this.resolveCoverUrl(files, dto);
    const oldCoverUrl = book.coverUrl;

    Object.assign(book, {
      ...dto,
      fileUrl: resolvedFile ? resolvedFile.fileUrl : book.fileUrl,
      fileOriginalName: resolvedFile
        ? resolvedFile.fileOriginalName
        : book.fileOriginalName,
      coverUrl: newCoverUrl ?? book.coverUrl,
    });

    const saved = await this.booksRepo.save(book);

    if (resolvedFile && oldFileUrl) await this.deleteLocalAsset(oldFileUrl);
    if (newCoverUrl && oldCoverUrl && oldCoverUrl !== newCoverUrl) {
      await this.deleteLocalAsset(oldCoverUrl);
    }

    // only a changed PDF needs re-embedding; a title-only edit just
    // relabels the existing chunks (see AiService.renameBookInIndex)
    if (resolvedFile) this.aiService.indexBookInBackground(saved);
    else if (dto.title) this.aiService.renameBookInIndex(saved.id, saved.title);

    return saved;
  }

  // the one mutation anyone browsing the site can trigger, not just
  // whoever's adding books — kept separate from update() so it never
  // touches files or requires multipart parsing
  async updateStatus(id: string, dto: UpdateBookStatusDto): Promise<Book> {
    const book = await this.findOne(id);
    if (dto.readStatus !== undefined) {
      const next = dto.readStatus;
      // real timestamps instead of guessing from updatedAt (which
      // changes on any edit, not just a status change) — these back
      // both the "đọc năm nay" stat and the "đọc dở lâu rồi" nudge
      if (next === 'reading' && book.readStatus !== 'reading') {
        book.startedAt = new Date();
      }
      if (next === 'done' && book.readStatus !== 'done') {
        book.finishedAt = new Date();
      }
      if (next !== 'done') book.finishedAt = null;
      if (next !== 'reading' && next !== 'done') book.startedAt = null;
      book.readStatus = next;
    }
    return this.booksRepo.save(book);
  }

  // fire-and-forget from the frontend on every card open — an atomic SQL
  // increment instead of read-modify-write so rapid/concurrent clicks
  // can't race and lose a count; silently a no-op if the id is stale
  async incrementView(id: string): Promise<void> {
    await this.booksRepo.increment({ id }, 'viewCount', 1);
  }

  async remove(id: string): Promise<void> {
    const book = await this.findOne(id);
    await this.booksRepo.remove(book);
    await this.deleteLocalAsset(book.fileUrl);
    await this.deleteLocalAsset(book.coverUrl);
    this.aiService.removeBookIndexInBackground(id);
  }

  private resolveCoverUrl(
    files: UploadedBookFiles,
    dto: CreateBookDto | UpdateBookDto,
  ): string | undefined {
    const coverFile = files.cover?.[0];
    if (coverFile) return `covers/${coverFile.filename}`;
    if (dto.coverUrl) return dto.coverUrl;
    return undefined;
  }

  // uploaded file wins if both are somehow present; otherwise fetch the
  // pasted PDF link server-side and store it exactly like an upload
  private async resolveBookFile(
    files: UploadedBookFiles,
    dto: CreateBookDto | UpdateBookDto,
  ): Promise<ResolvedBookFile | undefined> {
    const bookFile = files.file?.[0];
    if (bookFile) {
      return {
        fileUrl: `books/${bookFile.filename}`,
        fileOriginalName: bookFile.originalname,
      };
    }
    if (dto.pdfUrl) {
      const { filename, originalName } = await this.downloadPdfFromUrl(
        dto.pdfUrl,
      );
      return { fileUrl: `books/${filename}`, fileOriginalName: originalName };
    }
    return undefined;
  }

  private async downloadPdfFromUrl(
    url: string,
  ): Promise<{ filename: string; originalName: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch {
      throw new BadRequestException(
        'Không tải được file từ link đã cho (hết thời gian chờ hoặc không truy cập được)',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new BadRequestException(
        `Không tải được file từ link đã cho (HTTP ${res.status})`,
      );
    }

    const contentType = res.headers.get('content-type') || '';
    const looksLikePdfUrl = url.toLowerCase().split('?')[0].endsWith('.pdf');
    if (!contentType.includes('application/pdf') && !looksLikePdfUrl) {
      throw new BadRequestException('Link không trỏ tới một file PDF');
    }

    const declaredSize = Number(res.headers.get('content-length') || 0);
    if (declaredSize > MAX_PDF_SIZE_BYTES) {
      throw new BadRequestException('File PDF vượt quá dung lượng cho phép');
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_PDF_SIZE_BYTES) {
      throw new BadRequestException('File PDF vượt quá dung lượng cho phép');
    }
    if (buffer.subarray(0, 5).toString('latin1') !== PDF_MAGIC_BYTES) {
      throw new BadRequestException('File tải về không phải PDF hợp lệ');
    }

    const filename = `${uuidv4()}.pdf`;
    await fs.writeFile(join(this.uploadDir, 'books', filename), buffer);

    const lastSegment = decodeURIComponent(
      url.split('/').pop()?.split('?')[0] || '',
    );
    const originalName = lastSegment.toLowerCase().endsWith('.pdf')
      ? lastSegment
      : `${lastSegment || 'sach'}.pdf`;

    return { filename, originalName };
  }

  private async nextNum(categoryId: string): Promise<string> {
    const count = await this.booksRepo.count({ where: { categoryId } });
    return String(count + 1).padStart(2, '0');
  }

  // only deletes assets we actually store locally (relative "books/…" or
  // "covers/…" paths) — external cover URLs are left alone
  private async deleteLocalAsset(relativePath?: string): Promise<void> {
    if (!relativePath || /^https?:\/\//i.test(relativePath)) return;
    const fullPath = join(this.uploadDir, relativePath);
    try {
      await fs.unlink(fullPath);
    } catch {
      // best-effort cleanup only, missing file is not an error
    }
  }
}
