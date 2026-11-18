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
import { MAX_PDF_SIZE_BYTES } from '../../common/utils/storage';
import { CategoriesService } from '../categories/categories.service';
import { TranslationWorkerService } from '../translation-queue/translation-worker.service';
import { detectBookLanguage } from './detect-language';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { CreateBookQuoteDto } from './dto/create-book-quote.dto';

export interface UploadedBookFiles {
  file?: Express.Multer.File[];
  cover?: Express.Multer.File[];
  translatedFile?: Express.Multer.File[];
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
    @InjectRepository(BookQuote)
    private readonly bookQuotesRepo: Repository<BookQuote>,
    private readonly categoriesService: CategoriesService,
    private readonly config: ConfigService,
    private readonly translationWorkerService: TranslationWorkerService,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR', './uploads');
  }

  findAll(categoryId?: string): Promise<Book[]> {
    return this.booksRepo.find({
      where: categoryId ? { categoryId } : {},
      order: { createdAt: 'ASC' },
      relations: { category: true, quotes: true },
    });
  }

  async findOne(id: string): Promise<Book> {
    const book = await this.booksRepo.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!book) throw new NotFoundException('Không tìm thấy sách');
    return book;
  }

  // a quote is the book's own words — admin-managed, shown read-only
  // to readers on the catalog
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

    const resolvedTranslatedFile = this.resolveTranslatedFile(files);
    const detectedLanguage = await detectBookLanguage(
      join(this.uploadDir, resolvedFile.fileUrl),
    );
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
      translatedFileUrl: resolvedTranslatedFile?.fileUrl ?? null,
      translatedFileOriginalName:
        resolvedTranslatedFile?.fileOriginalName ?? null,
      detectedLanguage,
    });

    return this.booksRepo.save(book);
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
    const resolvedTranslatedFile = this.resolveTranslatedFile(files);
    const oldTranslatedFileUrl = book.translatedFileUrl;
    // a genuinely new PDF needs re-checking — an edit that leaves the file
    // untouched can't have changed what language it's in. But a book added
    // *before* language detection existed (or whose first attempt came back
    // null — a scanned page, say) has never been checked at all: retry
    // against its already-stored file so just opening "Sửa" and hitting
    // "Lưu" — no re-upload needed — is enough to backfill it
    const detectedLanguage = resolvedFile
      ? await detectBookLanguage(join(this.uploadDir, resolvedFile.fileUrl))
      : book.detectedLanguage === null
        ? await detectBookLanguage(join(this.uploadDir, book.fileUrl))
        : book.detectedLanguage;

    Object.assign(book, {
      ...dto,
      fileUrl: resolvedFile ? resolvedFile.fileUrl : book.fileUrl,
      fileOriginalName: resolvedFile
        ? resolvedFile.fileOriginalName
        : book.fileOriginalName,
      coverUrl: newCoverUrl ?? book.coverUrl,
      translatedFileUrl: resolvedTranslatedFile
        ? resolvedTranslatedFile.fileUrl
        : book.translatedFileUrl,
      translatedFileOriginalName: resolvedTranslatedFile
        ? resolvedTranslatedFile.fileOriginalName
        : book.translatedFileOriginalName,
      detectedLanguage,
    });

    const saved = await this.booksRepo.save(book);

    if (resolvedFile && oldFileUrl) await this.deleteLocalAsset(oldFileUrl);
    if (newCoverUrl && oldCoverUrl && oldCoverUrl !== newCoverUrl) {
      await this.deleteLocalAsset(oldCoverUrl);
    }
    if (resolvedTranslatedFile && oldTranslatedFileUrl) {
      await this.deleteLocalAsset(oldTranslatedFileUrl);
    }

    return saved;
  }

  // fire-and-forget from the reading page on every book open — an atomic SQL
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
    await this.deleteLocalAsset(book.translatedFileUrl ?? undefined);
  }

  // marks a book "please translate this" — TranslationWorkerService (a
  // separate polling loop, see that module) picks up 'queued' books one
  // at a time and does the actual work. Kept here rather than in that
  // service because the validation is about the book's own state, which
  // this service already owns.
  async queueTranslation(id: string): Promise<Book> {
    const book = await this.findOne(id);
    if (book.detectedLanguage !== 'foreign') {
      throw new BadRequestException(
        'Chỉ biên dịch được sách được nhận diện là sách nước ngoài',
      );
    }
    if (book.translationJobStatus === 'done') {
      // deliberate: an automated re-translate of a book that's already
      // finished is never triggered on its own — see docs/vi-translate.md.
      // Replacing it is still possible, just has to be a deliberate manual
      // upload through the edit form, not this endpoint. A 'partial' book
      // (translatedFileUrl set, but not yet 'done') is NOT blocked here —
      // that's exactly the case this endpoint is for: force the next
      // auto-retry to happen now instead of waiting for its scheduled time.
      throw new BadRequestException('Sách này đã có bản dịch rồi');
    }
    if (
      book.translationJobStatus === 'queued' ||
      book.translationJobStatus === 'processing'
    ) {
      throw new BadRequestException('Sách này đang được biên dịch rồi');
    }
    book.translationJobStatus = 'queued';
    book.translationJobError = null;
    book.translationNextRetryAt = null;
    const saved = await this.booksRepo.save(book);
    // nudge the worker to check right now instead of waiting for its next
    // @Cron tick (up to 15s away) — not awaited: the admin gets "queued"
    // back immediately either way, this only affects how soon it actually
    // starts, never the response itself. Same poll() the cron tick calls,
    // so nothing behaves differently here — just runs sooner.
    this.translationWorkerService.poll().catch(() => undefined);
    return saved;
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

  // upload-only, no paste-a-link alternative (unlike the original PDF's
  // pdfUrl) — a translated PDF is always produced elsewhere first (see
  // docs/vi-translate.md), never fetched from an arbitrary URL server-side
  private resolveTranslatedFile(
    files: UploadedBookFiles,
  ): ResolvedBookFile | undefined {
    const translatedFile = files.translatedFile?.[0];
    if (!translatedFile) return undefined;
    return {
      fileUrl: `books/${translatedFile.filename}`,
      fileOriginalName: translatedFile.originalname,
    };
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
