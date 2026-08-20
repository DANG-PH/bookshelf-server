import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { GoogleGenAI } from '@google/genai';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { Book } from '../../database/entities/book.entity';
import { chunkPdf } from './rag/pdf-chunker';
import { EmbeddedChunk, InMemoryVectorStore } from './rag/vector-store';

const CACHE_TTL_MS = 5 * 60 * 1000;
// spread out embedding calls so a library with many books doesn't blow
// through Gemini's per-minute rate limit on first boot
const EMBED_DELAY_MS = 200;

export interface AiStatus {
  configured: boolean;
  indexedChunks: number;
  // count of books that finished indexing completely — a book that hit
  // an error partway through does NOT count here, even though some of
  // its chunks already made it into indexedChunks, because it still
  // needs a retry to fill the gaps
  indexedBooks: number;
  totalBooks: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface PersistedIndex {
  chunks: EmbeddedChunk[];
  completedBookIds: string[];
}

type IndexResult = 'complete' | 'partial' | 'quota-exceeded';

// RAG chatbot over the PDFs already sitting in the library — each book's
// text gets chunked + embedded once and cached to disk; asking a
// question embeds the question, finds the closest chunks, and hands
// them to the model as context instead of letting it guess.
//
// Uses @google/genai (the current, actively-maintained SDK) — the older
// @google/generative-ai package it started on was fully deprecated by
// Google in August 2025 and stopped getting bug fixes, which is exactly
// the kind of thing that causes embedding calls to fail silently months
// later with nothing but a swallowed per-chunk warning to show for it.
@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenAI | null;
  private readonly vectorStore = new InMemoryVectorStore();
  private readonly responseCache = new Map<
    string,
    { message: string; expiresAt: number }
  >();
  private readonly uploadDir: string;
  private readonly indexPath: string;
  // surfaced via GET /ai/status so a stuck/empty index can be diagnosed
  // without needing to go dig through `pm2 logs`
  private lastSyncAt: Date | null = null;
  private lastError: string | null = null;
  // books that finished indexing with every chunk embedded — separate
  // from vectorStore's contents because a book that got cut off partway
  // (e.g. daily quota ran out) still has *some* chunks in the vector
  // store, but needs to be retried, not skipped, on the next sync
  private completedBookIds = new Set<string>();

  // Chat model, tried in order — falls through on quota/overload errors
  // instead of failing the whole request.
  private readonly CHAT_MODELS = [
    // Gemini 2.0 — stable, rarely 503s, tried first
    'gemini-2.0-flash',
    'gemini-2.0-flash-001', // pinned version, steadier than the alias
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-lite-001',

    // Gemini 2.5 — stronger but overloaded more often
    'gemini-2.5-flash-lite', // lite first, less prone to overload
    'gemini-2.5-flash',

    // Gemini 3.x preview — last resort if everything above fails
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
  ];

  // embedding doesn't burn quota the way generation does — one model, no fallback needed
  private readonly EMBED_MODEL = 'gemini-embedding-001';
  // Gemini's embedContent quota is metered per *request*, not per text —
  // batching chunks into one call instead of one request per chunk cuts
  // request count by ~20x, which is the difference between finishing a
  // 14-book library comfortably inside the free tier's 1000/day cap and
  // blowing through it by the second book.
  private readonly EMBED_BATCH_SIZE = 20;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Book) private readonly booksRepo: Repository<Book>,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    this.genAI = apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.uploadDir = this.config.get<string>('UPLOAD_DIR', './uploads');
    this.indexPath = join(this.uploadDir, 'rag-index.json');
  }

  onModuleInit(): void {
    if (!this.genAI) {
      this.logger.warn(
        '[AI] GEMINI_API_KEY chưa cấu hình — bỏ qua đánh index, /ai/ask sẽ báo chatbot chưa bật.',
      );
      return;
    }
    // fire-and-forget: indexing a whole library can take a while (one
    // embedding call per chunk), and the rest of the API shouldn't wait
    // on it to finish booting
    this.syncIndexWithLibrary().catch((err: Error) => {
      this.lastError = err.message;
      this.logger.error(`[AI] đánh index thất bại: ${err.message}`);
    });
  }

  async getStatus(): Promise<AiStatus> {
    const totalBooks = await this.booksRepo.count();
    return {
      configured: Boolean(this.genAI),
      indexedChunks: this.vectorStore.size,
      indexedBooks: this.completedBookIds.size,
      totalBooks,
      lastSyncAt: this.lastSyncAt ? this.lastSyncAt.toISOString() : null,
      lastError: this.lastError,
    };
  }

  // reconciles the persisted index against whatever books actually exist
  // right now — drops chunks for books that got deleted while the app
  // wasn't running, and indexes any book that isn't fully indexed yet
  // (including one left partway-done by a previous quota-exceeded run)
  private async syncIndexWithLibrary(): Promise<void> {
    await this.loadPersistedIndex();

    const books = await this.booksRepo.find();
    const bookIds = new Set(books.map((b) => b.id));

    const staleIds = [...this.vectorStore.indexedBookIds].filter(
      (id) => !bookIds.has(id),
    );
    staleIds.forEach((id) => this.vectorStore.removeByBookId(id));
    [...this.completedBookIds]
      .filter((id) => !bookIds.has(id))
      .forEach((id) => this.completedBookIds.delete(id));
    if (staleIds.length) {
      this.logger.log(`[AI] Bỏ ${staleIds.length} sách đã xoá khỏi index`);
    }

    const missing = books.filter((b) => !this.completedBookIds.has(b.id));
    if (missing.length) {
      this.logger.log(
        `[AI] ${missing.length} sách chưa đánh index xong — bắt đầu…`,
      );
      for (const book of missing) {
        const result = await this.indexBook(book).catch((err: Error) => {
          this.lastError = `"${book.title}": ${err.message}`;
          this.logger.warn(
            `[AI] Không đánh index được "${book.title}": ${err.message}`,
          );
          return 'partial' as const;
        });
        if (result === 'quota-exceeded') {
          // every remaining book would just hit the same wall — stop
          // here instead of hammering the API with guaranteed 429s
          break;
        }
      }
    }

    this.lastSyncAt = new Date();
    await this.persistIndex();
  }

  private async loadPersistedIndex(): Promise<void> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      const saved = JSON.parse(raw) as PersistedIndex;
      this.vectorStore.load(saved.chunks ?? []);
      this.completedBookIds = new Set(saved.completedBookIds ?? []);
      this.logger.log(
        `[AI] Nạp ${this.vectorStore.size} đoạn từ index có sẵn (${this.completedBookIds.size} sách đã đánh index xong)`,
      );
    } catch {
      // no index on disk yet — fine, syncIndexWithLibrary will build one
    }
  }

  private async persistIndex(): Promise<void> {
    await fs.mkdir(this.uploadDir, { recursive: true }).catch(() => undefined);
    const payload: PersistedIndex = {
      chunks: this.vectorStore.dump(),
      completedBookIds: [...this.completedBookIds],
    };
    await fs.writeFile(this.indexPath, JSON.stringify(payload));
  }

  // reads the book's PDF off disk, chunks + embeds it, and replaces
  // whatever was previously indexed for it (safe to call again after
  // the file changes on an edit, or to retry a book left incomplete by
  // a previous quota-exceeded run)
  async indexBook(book: Book): Promise<IndexResult> {
    if (!this.genAI) return 'partial';
    this.vectorStore.removeByBookId(book.id);
    this.completedBookIds.delete(book.id);

    const filePath = join(this.uploadDir, book.fileUrl);
    let chunks: string[];
    try {
      chunks = await chunkPdf(filePath);
    } catch (err) {
      const msg = `Không đọc được PDF của "${book.title}": ${(err as Error).message}`;
      this.lastError = msg;
      this.logger.warn(`[AI] ${msg}`);
      return 'partial';
    }

    const embedded: EmbeddedChunk[] = [];
    let quotaExceeded = false;

    for (let i = 0; i < chunks.length; i += this.EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + this.EMBED_BATCH_SIZE);
      try {
        const vectors = await this.embedBatch(batch);
        batch.forEach((text, idx) =>
          embedded.push({
            bookId: book.id,
            bookTitle: book.title,
            text,
            embedding: vectors[idx],
          }),
        );
      } catch (err) {
        if (this.isQuotaExceededError(err)) {
          this.lastError =
            'Hết quota embedding Gemini miễn phí trong ngày — sẽ tự đánh index tiếp ở lần chạy sau.';
          this.logger.warn(
            `[AI] ${this.lastError} (dừng tại "${book.title}", đã xong ${embedded.length}/${chunks.length} đoạn)`,
          );
          quotaExceeded = true;
          break;
        }
        const message = (err as Error).message;
        this.lastError = `"${book.title}": ${message}`;
        this.logger.warn(
          `[AI] Bỏ qua 1 nhóm đoạn của "${book.title}": ${message}`,
        );
      }
      await new Promise((r) => setTimeout(r, EMBED_DELAY_MS));
    }

    this.vectorStore.add(embedded);

    const complete = !quotaExceeded && embedded.length === chunks.length;
    if (complete) this.completedBookIds.add(book.id);

    this.logger.log(
      `[AI] ${complete ? 'Đã đánh index' : 'Đánh index dở, sẽ tiếp tục sau'} "${book.title}" (${embedded.length}/${chunks.length} đoạn)`,
    );

    if (complete) return 'complete';
    return quotaExceeded ? 'quota-exceeded' : 'partial';
  }

  // called by BooksService right after a book is created or its PDF
  // file is replaced — never awaited there, so adding/editing a book
  // doesn't sit around waiting on embedding calls
  indexBookInBackground(book: Book): void {
    if (!this.genAI) return;
    this.indexBook(book)
      .then(() => this.persistIndex())
      .catch((err: Error) => {
        this.lastError = `"${book.title}": ${err.message}`;
        this.logger.warn(
          `[AI] Đánh index nền thất bại cho "${book.title}": ${err.message}`,
        );
      });
  }

  removeBookIndexInBackground(bookId: string): void {
    if (!this.genAI) return;
    this.vectorStore.removeByBookId(bookId);
    this.completedBookIds.delete(bookId);
    this.persistIndex().catch(() => undefined);
  }

  // title-only edits don't touch the PDF, so just relabel the existing
  // chunks instead of paying for a re-embed
  renameBookInIndex(bookId: string, newTitle: string): void {
    if (!this.genAI) return;
    this.vectorStore.renameBook(bookId, newTitle);
    this.persistIndex().catch(() => undefined);
  }

  async chatCompletion(message: string): Promise<{ message: string }> {
    if (!this.genAI) {
      return {
        message:
          'Chatbot chưa được bật — cần cấu hình GEMINI_API_KEY trước đã.',
      };
    }

    try {
      const cacheKey = this.hashKey(message);
      const cached = this.responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return { message: cached.message };
      }

      // runs no matter what happens to the AI calls below — it's a plain
      // DB query, not an API call, so it still finds "Ove" by title even
      // when the book hasn't finished vector-indexing yet, or the AI is
      // rate-limited and query embedding fails entirely
      const metadataMatches = await this.searchBooksByKeyword(message);

      let relevant: EmbeddedChunk[] = [];
      try {
        const queryEmbedding = await this.embedText(message);
        relevant = this.vectorStore.search(queryEmbedding, 4);
      } catch (err) {
        this.lastError = `embed câu hỏi: ${(err as Error).message}`;
        this.logger.warn(
          `[AI] embed câu hỏi thất bại, dùng thông tin sách trong DB thay thế: ${(err as Error).message}`,
        );
        // no chunk context this time, but keep going — generateWithFallback
        // can still answer from metadataMatches below
      }

      const chunkContext = relevant
        .map((c) => `[Trích đoạn - "${c.bookTitle}"]\n${c.text}`)
        .join('\n\n---\n\n');
      const metadataContext = metadataMatches
        .map((b) => this.bookMetadataBlock(b))
        .join('\n\n---\n\n');
      const context = [chunkContext, metadataContext]
        .filter(Boolean)
        .join('\n\n---\n\n');

      const systemPrompt =
        this.config.get<string>('AI_SYSTEM_PROMPT') ||
        'Bạn là trợ lý tri thức thân thiện của một thư viện sách cá nhân. Trả lời mọi câu hỏi một cách tự nhiên, đầy đủ và hữu ích bằng kiến thức của bạn — đừng chỉ hành xử như một công cụ tra cứu giới hạn trong phạm vi thư viện. Ngắn gọn, ấm áp, không dài dòng.';

      const ragPrompt = `
${systemPrompt}

${
  context
    ? `Một vài sách/đoạn trích trong thư viện có thể liên quan đến câu hỏi này — dùng để gợi ý, không phải để giới hạn câu trả lời:\n---\n${context}\n---\n`
    : ''
}
Câu hỏi: ${message}

Hướng dẫn trả lời:
- Trả lời câu hỏi một cách tự nhiên, đầy đủ bằng kiến thức của bạn — không cần bó buộc chỉ trong các đoạn trích ở trên
- Nếu có sách trong thư viện liên quan (xem phần trên), khéo léo nhắc đến cuốn đó như một gợi ý đọc thêm trong câu trả lời
- Nếu không có sách nào liên quan, cứ trả lời bình thường bằng kiến thức của bạn — không cần nói gì về việc thư viện có hay không có sách
- Trả lời ngắn gọn, dùng gạch đầu dòng nếu có nhiều ý, có thể dùng **in đậm** cho từ khoá quan trọng
      `.trim();

      const replyText = await this.generateWithFallback(ragPrompt);
      if (!replyText) {
        // the model itself is unreachable right now (overloaded, or the
        // generation quota's blown too) — answer directly from whatever
        // book metadata matched instead of just apologizing
        return { message: this.metadataOnlyReply(metadataMatches) };
      }

      this.responseCache.set(cacheKey, {
        message: replyText,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return { message: replyText };
    } catch (err) {
      this.lastError = (err as Error).message;
      this.logger.error(`[AI] chatCompletion lỗi: ${(err as Error).message}`);
      return { message: 'Có lỗi xảy ra, thử lại nhé.' };
    }
  }

  // Vietnamese/English filler words stripped before matching the question's
  // remaining words against book titles/authors — short and deliberately
  // conservative, this only needs to isolate the word that's actually the
  // subject of the question (e.g. "ove" out of "người đàn ông mang tên ove ấy?")
  private readonly STOPWORDS = new Set([
    'là',
    'gì',
    'ai',
    'của',
    'và',
    'hay',
    'không',
    'có',
    'nào',
    'này',
    'đó',
    'ấy',
    'người',
    'cuốn',
    'sách',
    'trong',
    'thư',
    'viện',
    'cho',
    'tôi',
    'em',
    'anh',
    'mình',
    'nói',
    'về',
    'thế',
    'nhé',
    'với',
    'the',
    'a',
    'an',
    'is',
    'are',
    'what',
    'who',
    'how',
  ]);

  // plain title/author keyword search — no API call, so it works even when
  // the AI is unreachable, and finds a book by name before it's finished
  // (or ever gets to finish) vector-indexing
  private async searchBooksByKeyword(
    message: string,
    limit = 3,
  ): Promise<Book[]> {
    const words = message
      .toLowerCase()
      .replace(/[?.,!"'();:]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !this.STOPWORDS.has(w));
    if (!words.length) return [];

    const qb = this.booksRepo.createQueryBuilder('book');
    words.forEach((w, i) => {
      qb.orWhere(`book.title ILIKE :w${i} OR book.author ILIKE :w${i}`, {
        [`w${i}`]: `%${w}%`,
      });
    });
    return qb.take(limit).getMany();
  }

  private bookMetadataBlock(b: Book): string {
    const lines = [
      `[Thông tin sách - "${b.title}"${b.author ? ` của ${b.author}` : ''}]`,
    ];
    lines.push(b.blurb || b.note || '(chưa có mô tả)');
    return lines.join('\n');
  }

  // used only when the model itself couldn't be reached at all — a plain
  // template answer from DB metadata beats a bare apology, but it's not a
  // real generated response so it's kept honest about that
  private metadataOnlyReply(matches: Book[]): string {
    if (!matches.length) return this.pickRandom(this.OVERLOADED_REPLIES);
    const lines = [
      'AI đang hơi quá tải nên chưa soạn được câu trả lời đầy đủ, nhưng thư viện có mấy cuốn liên quan nè:',
      '',
      ...matches.map(
        (b) =>
          `- "${b.title}"${b.author ? ` của ${b.author}` : ''}${b.blurb ? `: ${b.blurb}` : ''}`,
      ),
    ];
    return lines.join('\n');
  }

  private readonly OVERLOADED_REPLIES = [
    'AI hơi quá tải rồi, thử hỏi lại sau ít phút nhé.',
    'Đang đông người hỏi quá, đợi chút rồi hỏi lại giúp mình nhé.',
    'AI đang nghỉ mệt xíu, lát quay lại hỏi tiếp nhé.',
  ];

  private pickRandom(options: string[]): string {
    return options[Math.floor(Math.random() * options.length)];
  }

  private async embedText(text: string): Promise<number[]> {
    const [values] = await this.embedBatch([text]);
    return values;
  }

  // one embedContent call for up to EMBED_BATCH_SIZE texts at once —
  // Gemini's quota is metered per request, so this is what keeps a
  // whole-library index run from burning through the daily cap
  private async embedBatch(texts: string[]): Promise<number[][]> {
    const result = await this.genAI!.models.embedContent({
      model: this.EMBED_MODEL,
      contents: texts,
    });
    const embeddings = result.embeddings;
    if (!embeddings || embeddings.length !== texts.length) {
      throw new Error(
        `Gemini trả về ${embeddings?.length ?? 0} embedding cho ${texts.length} đoạn`,
      );
    }
    return embeddings.map((e) => {
      if (!e.values || e.values.length === 0) {
        throw new Error('Gemini trả về embedding rỗng');
      }
      return e.values;
    });
  }

  private isQuotaExceededError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('"code":429');
  }

  private async generateWithFallback(prompt: string): Promise<string | null> {
    for (const modelName of this.CHAT_MODELS) {
      try {
        const response = await this.genAI!.models.generateContent({
          model: modelName,
          contents: prompt,
        });
        if (response.text) return response.text;
      } catch (err) {
        const status =
          (err as { status?: number }).status ?? (err as Error).message;
        this.logger.warn(
          `[AI] model ${modelName} lỗi (${status}), thử model kế tiếp...`,
        );
      }
    }
    return null;
  }

  private hashKey(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }
}
