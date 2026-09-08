import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as http from 'http';
import * as https from 'https';
import { join, posix } from 'path';
import { Repository } from 'typeorm';
import { URL } from 'url';
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

// must stay ABOVE pdf-translator/server.py's own TIMEOUT_SECONDS (30 min)
// so the sidecar's own timeout fires first and hands back a real error —
// found the hard way: Node's global fetch() (undici) has a *default*
// headers-timeout of 5 minutes with no simple way to raise it without
// pulling in `undici` as its own dependency just for that, so this uses
// plain http/https.request() instead, which has no such ceiling of its
// own — a translation that's still running at the 5-minute mark used to
// come back as "fetch failed: Headers Timeout Error" even though the
// sidecar was still working the whole time
const TRANSLATE_TIMEOUT_MS = 31 * 60 * 1000;

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
      const { status, data } = await this.postJson(
        `${this.translatorUrl}/translate`,
        { inputPath: containerInputPath, outputDir: containerJobDir },
        TRANSLATE_TIMEOUT_MS,
      );
      if (status < 200 || status >= 300 || !data.ok || !data.outputPath) {
        throw new Error(data.error || `HTTP ${status}`);
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
      const message = this.describeError(err).slice(0, 2000);
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

  // Plain http/https.request() instead of fetch() — see the comment on
  // TRANSLATE_TIMEOUT_MS for why. `timeoutMs` is a socket-idle timeout
  // (fires after that long with zero bytes exchanged either way, which is
  // exactly what a slow /translate call looks like start to finish), not
  // an overall deadline — fine here since nothing else is expected to sit
  // idle on this connection.
  private postJson(
    urlStr: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<{ status: number; data: TranslateResponse }> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const payload = Buffer.from(JSON.stringify(body));
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            let data: TranslateResponse = {};
            try {
              data = text ? (JSON.parse(text) as TranslateResponse) : {};
            } catch {
              // leave data as {} — the status code alone still gets surfaced
            }
            resolve({ status: res.statusCode ?? 0, data });
          });
        },
      );
      req.on('timeout', () =>
        req.destroy(
          new Error(`không phản hồi sau ${Math.round(timeoutMs / 1000)}s`),
        ),
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // the actual reason for a connection-level failure sometimes lives on
  // err.cause (Node core network errors occasionally wrap it there) rather
  // than err.message alone — cheap to check, and the difference between
  // "fetch failed" and "fetch failed: connect ECONNREFUSED 127.0.0.1:8787"
  // is the whole reason this exists
  private describeError(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    const cause = (err as Error & { cause?: unknown }).cause;
    let causeText: string | undefined;
    if (cause instanceof Error) {
      causeText = cause.message;
    } else if (typeof cause === 'string' || typeof cause === 'number') {
      causeText = String(cause);
    } else if (cause !== undefined) {
      // an unknown-shaped cause (plain object, etc.) — JSON beats
      // Object's default toString() ("[object Object]"), and never
      // throws even on something circular/exotic
      try {
        causeText = JSON.stringify(cause);
      } catch {
        causeText = undefined;
      }
    }
    return causeText ? `${err.message}: ${causeText}` : err.message;
  }
}
