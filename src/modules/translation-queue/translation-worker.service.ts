import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as http from 'http';
import * as https from 'https';
import { join, posix } from 'path';
import { LessThanOrEqual, Repository } from 'typeorm';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { Book } from '../../database/entities/book.entity';
import { NotificationsService } from '../notifications/notifications.service';

interface TranslateResponse {
  ok?: boolean;
  outputPath?: string;
  error?: string;
  // how much of the document actually got translated this run — see
  // pdf-translator/server.py. `complete` is the one bit that decides
  // 'done' vs 'partial'; the counts are just for display.
  untranslatedCount?: number;
  totalSegments?: number;
  complete?: boolean;
  // only present on a timeout response — the last bit of what
  // translate_pdf.py had printed before the sidecar killed it (see
  // pdf-translator/server.py's _pump()). Worth folding into the error
  // shown in admin.html: it's the difference between "no idea what
  // happened" and actually seeing how far it got / what it was stuck on.
  stdoutTail?: string;
  stderrTail?: string;
}

// how long a free translation backend's daily quota needs to refill
// before another retry has any chance of making new progress — see
// pdf-translator/server.py's comment on the persistent translation
// cache: retrying sooner would just re-hit the same exhausted quota
// for no gain.
const RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

// how far behind "book got queued" a poll tick can lag, worst case — the
// real turnaround is dominated by however long the translator itself
// takes (minutes), so this only needs to be "soon", not instant
const POLL_CRON = '*/15 * * * * *';

// TRANSLATE timeout is computed at runtime from the sidecar's server
// timeout (PDF_TRANSLATOR_TIMEOUT_SECONDS) with a small buffer so the
// sidecar's own timeout fires first and returns a clear error. See the
// comment above about undici/fetch headers-timeout — using plain
// http/https.request() avoids that ceiling.

// single global concurrency, on purpose — the pdf-translator sidecar gets
// one CPU's worth of budget on a small VPS (see pdf-translator/server.py),
// so running two translations at once would just make both slower, not
// finish sooner
@Injectable()
export class TranslationWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TranslationWorkerService.name);
  private readonly translatorUrl?: string;
  private readonly translatorUploadPath: string;
  private readonly uploadDir: string;
  private translateTimeoutMs: number;
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
    // default must match pdf-translator/server.py's own default and
    // docker-compose.yml's PDF_TRANSLATOR_TIMEOUT_SECONDS exactly — all
    // three read the same .env variable, so setting it once anywhere
    // that matters is enough; see the comment in server.py for why 3h
    const serverTimeoutSec = Number(
      this.config.get<number>('PDF_TRANSLATOR_TIMEOUT_SECONDS', 3 * 60 * 60),
    );
    // add a small buffer so the Python sidecar times out first
    this.translateTimeoutMs = (serverTimeoutSec + 60) * 1000;
  }

  // a book can ONLY be 'processing' while some process is actively in
  // processOne() for it — so any 'processing' row still on disk when the
  // app is just starting up was, by definition, abandoned mid-flight by
  // the *previous* process (killed/restarted — pm2, a deploy, a crash),
  // not something this new process is doing itself. Found the hard way:
  // one such row sat stuck at 'processing' for 19 hours after a restart
  // dropped the in-flight request with nothing left to ever update it —
  // the sidecar itself had already stopped working on it long before.
  // Requeue rather than fail outright: whatever partial work existed on
  // the sidecar side is gone either way (a fresh container/process has
  // no memory of it), but the book itself is still just as translatable
  // as it was before the interruption.
  async onApplicationBootstrap(): Promise<void> {
    const orphaned = await this.booksRepo.find({
      where: { translationJobStatus: 'processing' },
    });
    if (!orphaned.length) return;
    this.logger.warn(
      `[Translate] ${orphaned.length} sách bị kẹt ở 'processing' từ lần chạy trước (rất có thể do restart giữa chừng) — đưa lại vào hàng đợi: ${orphaned.map((b) => b.title).join(', ')}`,
    );
    for (const book of orphaned) {
      book.translationJobStatus = 'queued';
      await this.booksRepo.save(book);
    }
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

    // manual/just-added triggers ('queued', see BooksService.queueTranslation)
    // always go first — a due retry can wait another 15s poll tick, someone
    // actively waiting on a fresh queue shouldn't
    const next =
      (await this.booksRepo.findOne({
        where: { translationJobStatus: 'queued' },
        order: { updatedAt: 'ASC' },
      })) ??
      (await this.booksRepo.findOne({
        where: [
          {
            translationJobStatus: 'partial',
            translationNextRetryAt: LessThanOrEqual(new Date()),
          },
          {
            translationJobStatus: 'failed',
            translationNextRetryAt: LessThanOrEqual(new Date()),
          },
        ],
        order: { translationNextRetryAt: 'ASC' },
      }));
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
        this.translateTimeoutMs,
      );
      if (status < 200 || status >= 300 || !data.ok || !data.outputPath) {
        const parts = [data.error || `HTTP ${status}`];
        // stderr is where translate_pdf.py's real failures/tracebacks
        // land; stdout only as a fallback if stderr came back empty
        if (data.stderrTail) parts.push(`[stderr] ${data.stderrTail}`);
        else if (data.stdoutTail) parts.push(`[stdout] ${data.stdoutTail}`);
        throw new Error(parts.join('\n'));
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
      book.translationUntranslatedCount = data.untranslatedCount ?? null;
      book.translationTotalSegments = data.totalSegments ?? null;
      book.translationJobError = null;

      if (data.complete) {
        book.translationJobStatus = 'done';
        book.translationNextRetryAt = null;
        await this.booksRepo.save(book);
        this.logger.log(`[Translate] Xong "${book.title}"`);
        this.notificationsService
          .create(`Đã biên dịch xong "${book.title}" sang tiếng Việt.`)
          .catch(() => undefined);
      } else {
        // still usable — translatedFileUrl above already points at this
        // run's (more complete than before) output — just not finished
        // yet, so schedule another attempt once quota has had a chance
        // to refill rather than requiring someone to click retry by hand
        book.translationJobStatus = 'partial';
        book.translationNextRetryAt = new Date(Date.now() + RETRY_DELAY_MS);
        await this.booksRepo.save(book);
        this.logger.log(
          `[Translate] "${book.title}" dịch được một phần (còn ${data.untranslatedCount ?? '?'}/${data.totalSegments ?? '?'} đoạn), sẽ tự thử lại sau`,
        );
        this.notificationsService
          .create(
            `"${book.title}" đã có bản dịch một phần, đọc được ngay — sẽ tự tiếp tục hoàn thiện.`,
          )
          .catch(() => undefined);
      }
    } catch (err) {
      const message = this.describeError(err).slice(0, 2000);
      book.translationJobStatus = 'failed';
      book.translationJobError = message;
      // do NOT touch translatedFileUrl here — a previous 'partial' run may
      // have already produced something readable, and this run failing
      // (sidecar down, timeout, ...) must not take that away
      book.translationNextRetryAt = new Date(Date.now() + RETRY_DELAY_MS);
      await this.booksRepo.save(book);
      this.logger.warn(`[Translate] "${book.title}" thất bại: ${message}`);
      this.notificationsService
        .create(`Biên dịch "${book.title}" thất bại, sẽ tự thử lại sau.`)
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
