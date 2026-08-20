import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

// RAG chatbot over the PDFs already sitting in the library — each book's
// text gets chunked + embedded once and cached to disk; asking a
// question embeds the question, finds the closest chunks, and hands
// them to the model as context instead of letting it guess.
@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenerativeAI | null;
  private readonly vectorStore = new InMemoryVectorStore();
  private readonly responseCache = new Map<
    string,
    { message: string; expiresAt: number }
  >();
  private readonly uploadDir: string;
  private readonly indexPath: string;

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

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Book) private readonly booksRepo: Repository<Book>,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    this.genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
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
    this.syncIndexWithLibrary().catch((err: Error) =>
      this.logger.error(`[AI] đánh index thất bại: ${err.message}`),
    );
  }

  // reconciles the persisted index against whatever books actually exist
  // right now — drops chunks for books that got deleted while the app
  // wasn't running, and indexes any book that's missing from it
  private async syncIndexWithLibrary(): Promise<void> {
    await this.loadPersistedIndex();

    const books = await this.booksRepo.find();
    const bookIds = new Set(books.map((b) => b.id));
    const indexedIds = this.vectorStore.indexedBookIds;

    const staleIds = [...indexedIds].filter((id) => !bookIds.has(id));
    staleIds.forEach((id) => this.vectorStore.removeByBookId(id));
    if (staleIds.length) {
      this.logger.log(`[AI] Bỏ ${staleIds.length} sách đã xoá khỏi index`);
    }

    const missing = books.filter((b) => !indexedIds.has(b.id));
    if (missing.length) {
      this.logger.log(`[AI] ${missing.length} sách chưa đánh index — bắt đầu…`);
      for (const book of missing) {
        await this.indexBook(book).catch((err: Error) =>
          this.logger.warn(
            `[AI] Không đánh index được "${book.title}": ${err.message}`,
          ),
        );
      }
    }

    await this.persistIndex();
  }

  private async loadPersistedIndex(): Promise<void> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      const saved = JSON.parse(raw) as EmbeddedChunk[];
      this.vectorStore.load(saved);
      this.logger.log(`[AI] Nạp ${this.vectorStore.size} đoạn từ index có sẵn`);
    } catch {
      // no index on disk yet — fine, syncIndexWithLibrary will build one
    }
  }

  private async persistIndex(): Promise<void> {
    await fs.mkdir(this.uploadDir, { recursive: true }).catch(() => undefined);
    await fs.writeFile(this.indexPath, JSON.stringify(this.vectorStore.dump()));
  }

  // reads the book's PDF off disk, chunks + embeds it, and replaces
  // whatever was previously indexed for it (safe to call again after
  // the file changes on an edit)
  async indexBook(book: Book): Promise<void> {
    if (!this.genAI) return;
    this.vectorStore.removeByBookId(book.id);

    const filePath = join(this.uploadDir, book.fileUrl);
    let chunks: string[];
    try {
      chunks = await chunkPdf(filePath);
    } catch (err) {
      this.logger.warn(
        `[AI] Không đọc được PDF của "${book.title}": ${(err as Error).message}`,
      );
      return;
    }

    const embedded: EmbeddedChunk[] = [];
    for (const text of chunks) {
      try {
        const embedding = await this.embedText(text);
        embedded.push({
          bookId: book.id,
          bookTitle: book.title,
          text,
          embedding,
        });
      } catch (err) {
        this.logger.warn(
          `[AI] Bỏ qua 1 đoạn của "${book.title}": ${(err as Error).message}`,
        );
      }
      await new Promise((r) => setTimeout(r, EMBED_DELAY_MS));
    }

    this.vectorStore.add(embedded);
    this.logger.log(
      `[AI] Đã đánh index "${book.title}" (${embedded.length} đoạn)`,
    );
  }

  // called by BooksService right after a book is created or its PDF
  // file is replaced — never awaited there, so adding/editing a book
  // doesn't sit around waiting on embedding calls
  indexBookInBackground(book: Book): void {
    if (!this.genAI) return;
    this.indexBook(book)
      .then(() => this.persistIndex())
      .catch((err: Error) =>
        this.logger.warn(
          `[AI] Đánh index nền thất bại cho "${book.title}": ${err.message}`,
        ),
      );
  }

  removeBookIndexInBackground(bookId: string): void {
    if (!this.genAI) return;
    this.vectorStore.removeByBookId(bookId);
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

      let queryEmbedding: number[];
      try {
        queryEmbedding = await this.embedText(message);
      } catch (err) {
        this.logger.error(
          `[AI] embed câu hỏi thất bại: ${(err as Error).message}`,
        );
        return {
          message: 'Không xử lý được câu hỏi lúc này, thử lại sau nhé.',
        };
      }

      const relevant = this.vectorStore.search(queryEmbedding, 4);
      const context = relevant
        .map((c) => `[Sách: ${c.bookTitle}]\n${c.text}`)
        .join('\n\n---\n\n');

      const systemPrompt =
        this.config.get<string>('AI_SYSTEM_PROMPT') ||
        'Bạn là trợ lý của một thư viện sách cá nhân. Trả lời ngắn gọn, đủ ý, không dài dòng, và nói rõ câu trả lời lấy từ cuốn sách nào nếu có.';

      const ragPrompt = `
${systemPrompt}

Các đoạn trích từ sách trong thư viện liên quan đến câu hỏi:
---
${context || '(chưa có đoạn nào liên quan trong thư viện)'}
---

Câu hỏi: ${message}

Hướng dẫn trả lời:
- Chỉ dựa vào các đoạn trích phía trên để trả lời
- Nếu không có đoạn nào liên quan, nói rõ: "Thư viện chưa có sách nào nói về vấn đề này"
- Không bịa thêm thông tin ngoài các đoạn trích
- Trả lời ngắn gọn, dùng gạch đầu dòng nếu có nhiều ý
      `.trim();

      const result = await this.generateWithFallback(ragPrompt);
      if (!result) {
        return { message: 'AI đang quá tải, thử lại sau khoảng 1 phút nhé.' };
      }

      const replyText = result.response.text();
      this.responseCache.set(cacheKey, {
        message: replyText,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return { message: replyText };
    } catch (err) {
      this.logger.error(`[AI] chatCompletion lỗi: ${(err as Error).message}`);
      return { message: 'Có lỗi xảy ra, thử lại nhé.' };
    }
  }

  private async embedText(text: string): Promise<number[]> {
    const model = this.genAI!.getGenerativeModel({ model: this.EMBED_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }

  private async generateWithFallback(prompt: string) {
    for (const modelName of this.CHAT_MODELS) {
      try {
        const model = this.genAI!.getGenerativeModel({ model: modelName });
        return await model.generateContent(prompt);
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
