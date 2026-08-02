import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CategoriesService } from '../categories/categories.service';
import { BooksService } from '../books/books.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly booksService: BooksService,
    private readonly settingsService: SettingsService,
    private readonly config: ConfigService,
  ) {}

  async build() {
    const [categories, books, settings] = await Promise.all([
      this.categoriesService.findAll(),
      this.booksService.findAll(),
      this.settingsService.get(),
    ]);

    const filesBase = `${this.config.get<string>('PUBLIC_URL', '')}/api/files`;
    const resolveAsset = (path?: string) => {
      if (!path) return undefined;
      if (/^https?:\/\//i.test(path)) return path;
      return `${filesBase}/${path}`;
    };

    return {
      updated: settings.updatedLabel ?? String(new Date().getFullYear()),
      curator: settings.curatorName
        ? {
            name: settings.curatorName,
            role: settings.curatorRole ?? undefined,
            photo: resolveAsset(settings.curatorPhoto) ?? settings.curatorPhoto,
          }
        : undefined,
      categories: categories.map((cat) => ({
        id: cat.slug,
        title: cat.title,
        dewey: cat.dewey,
        range: cat.range,
        intro: cat.intro,
        books: books
          .filter((b) => b.categoryId === cat.id)
          .map((b) => ({
            id: b.id,
            num: b.num,
            year: b.year,
            title: b.title,
            author: b.author,
            blurb: b.blurb,
            tags: b.tags,
            file: resolveAsset(b.fileUrl),
            cover: resolveAsset(b.coverUrl),
            isNew: b.isNew,
          })),
      })),
    };
  }
}
