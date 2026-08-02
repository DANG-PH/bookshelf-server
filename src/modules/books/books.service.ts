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
import { Book } from '../../database/entities/book.entity';
import { CategoriesService } from '../categories/categories.service';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';

export interface UploadedBookFiles {
  file?: Express.Multer.File[];
  cover?: Express.Multer.File[];
}

@Injectable()
export class BooksService {
  private readonly uploadDir: string;

  constructor(
    @InjectRepository(Book)
    private readonly booksRepo: Repository<Book>,
    private readonly categoriesService: CategoriesService,
    private readonly config: ConfigService,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR', './uploads');
  }

  findAll(categoryId?: string): Promise<Book[]> {
    return this.booksRepo.find({
      where: categoryId ? { categoryId } : {},
      order: { createdAt: 'ASC' },
      relations: { category: true },
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

  async create(dto: CreateBookDto, files: UploadedBookFiles): Promise<Book> {
    const bookFile = files.file?.[0];
    if (!bookFile) {
      throw new BadRequestException('Thiếu file PDF của sách');
    }

    await this.categoriesService.findOne(dto.categoryId);

    const book = this.booksRepo.create({
      categoryId: dto.categoryId,
      num: dto.num ?? (await this.nextNum(dto.categoryId)),
      year: dto.year,
      title: dto.title,
      author: dto.author,
      blurb: dto.blurb,
      tags: dto.tags,
      isNew: dto.isNew ?? true,
      fileUrl: `books/${bookFile.filename}`,
      fileOriginalName: bookFile.originalname,
      coverUrl: this.resolveCoverUrl(files, dto),
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

    const newBookFile = files.file?.[0];
    const oldFileUrl = book.fileUrl;
    const newCoverUrl = this.resolveCoverUrl(files, dto);
    const oldCoverUrl = book.coverUrl;

    Object.assign(book, {
      ...dto,
      fileUrl: newBookFile ? `books/${newBookFile.filename}` : book.fileUrl,
      fileOriginalName: newBookFile
        ? newBookFile.originalname
        : book.fileOriginalName,
      coverUrl: newCoverUrl ?? book.coverUrl,
    });

    const saved = await this.booksRepo.save(book);

    if (newBookFile && oldFileUrl) await this.deleteLocalAsset(oldFileUrl);
    if (newCoverUrl && oldCoverUrl && oldCoverUrl !== newCoverUrl) {
      await this.deleteLocalAsset(oldCoverUrl);
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const book = await this.findOne(id);
    await this.booksRepo.remove(book);
    await this.deleteLocalAsset(book.fileUrl);
    await this.deleteLocalAsset(book.coverUrl);
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
