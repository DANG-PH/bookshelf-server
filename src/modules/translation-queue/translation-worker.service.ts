import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { join, posix } from 'path';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Book } from '../../database/entities/book.entity';
import { NotificationsService } from '../notifications/notifications.service';

interface TranslateResponse {
  ok?: boolean;
  outputPath?: string;
  error?: string;
}

// how far behind "book got queued" a poll tick can lag, worst case — the
// real turnaround is dominated by however long the translator itself
// takes (minutes), so this only needs to be "soon", not instant
const POLL_CRON = '*/15 * * * * *';

// single global concurrency, on purpose — the pdf-translator sidecar gets
// one CPU's worth of budget on a small VPS (see pdf-translator/server.py),
// so running two translations at once would just make both slower, not
// finish sooner
@Injectable()
export class TranslationWorkerService {
  private readonly logger = new Logger(TranslationWorkerService.name);
  private readonly translatorUrl?: string;
  private readonly translatorUploadPath: string;
  private readonly uploadDir: string;
  // guards against a poll tick starting a second run while the previous
  // one's HTTP call (which can take many minutes) is still in flight —
  // the DB-side 'processing' check below covers the same case across a
  // restart, this just avoids relying on that race window at all
  private running = false;

  constructor(
    @InjectRepository(Book)
    private readonly booksRepo: Repository<Book>,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.translatorUrl = this.config.get<string>('PDF_TRANSLATOR_URL');
    this.translatorUploadPath = this.config.get<string>(
      'PDF_TRANSLATOR_UPLOAD_PATH',
      '/uploads',
    );
    this.uploadDir = this.config.get<string>('UPLOAD_DIR', './uploads');
  }

  @Cron(POLL_CRON)
  async poll(): Promise<void> {
    // PDF_TRANSLATOR_URL unset — feature simply isn't available, same
    // "leave it unset and nothing else breaks" pattern as PushService/
    // AiService's optional config
    if (!this.translatorUrl || this.running) return;

    const alreadyProcessing = await this.booksRepo.count({
      where: { translationJobStatus: 'processing' },
    });
    if (alreadyProcessing > 0) return;

    const next = await this.booksRepo.findOne({
      where: { translationJobStatus: 'queued' },
      order: { updatedAt: 'ASC' },
    });
    if (!next) return;

    this.running = true;
    try {
      await this.processOne(next);
    } finally {
      this.running = false;
    }
  }

  private async processOne(book: Book): Promise<void> {
    book.translationJobStatus = 'processing';
    await this.booksRepo.save(book);
    this.logger.log(`[Translate] Bắt đầu biên dịch "${book.title}"`);

    // scratch space shared with the sidecar container via the same
    // bind-mounted UPLOAD_DIR (docker-compose.yml) — hostJobDir and
    // containerJobDir are the same physical folder, just addressed by
    // the path each side actually sees it at
    const jobRelDir = posix.join('translate-tmp', book.id);
    const hostJobDir = join(this.uploadDir, jobRelDir);
    const containerJobDir = posix.join(this.translatorUploadPath, jobRelDir);
    const containerInputPath = posix.join(
      this.translatorUploadPath,
      book.fileUrl,
    );

    try {
      const res = await fetch(`${this.translatorUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputPath: containerInputPath,
          outputDir: containerJobDir,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as TranslateResponse;
      if (!res.ok || !data.ok || !data.outputPath) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      // data.outputPath is the *container* path — same bytes are already
      // visible to this process at hostJobDir, just need the filename
      const producedFilename = data.outputPath.split('/').pop();
      if (!producedFilename) throw new Error('phản hồi thiếu tên file kết quả');
      const hostProducedPath = join(hostJobDir, producedFilename);

      const finalRelativePath = `books/${uuidv4()}.pdf`;
      await fs.rename(
        hostProducedPath,
        join(this.uploadDir, finalRelativePath),
      );

      book.translatedFileUrl = finalRelativePath;
      book.translatedFileOriginalName = book.fileOriginalName
        ? `${book.fileOriginalName.replace(/\.pdf$/i, '')} (bản dịch).pdf`
        : null;
      book.translationJobStatus = 'done';
      book.translationJobError = null;
      await this.booksRepo.save(book);

      this.logger.log(`[Translate] Xong "${book.title}"`);
      this.notificationsService
        .create(`Đã biên dịch xong "${book.title}" sang tiếng Việt.`)
        .catch(() => undefined);
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 2000);
      book.translationJobStatus = 'failed';
      book.translationJobError = message;
      await this.booksRepo.save(book);
      this.logger.warn(`[Translate] "${book.title}" thất bại: ${message}`);
      this.notificationsService
        .create(`Biên dịch "${book.title}" thất bại, thử lại nhé.`)
        .catch(() => undefined);
    } finally {
      await fs
        .rm(hostJobDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}
