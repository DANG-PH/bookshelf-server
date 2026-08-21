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

    // explicit timeZone here rather than relying on the server process's
    // ambient TZ — the server should stay on UTC internally (that's what
    // keeps stored timestamps unambiguous); only human-facing text like
    // this needs to be converted to Vietnam time, and only right here
    const vnYear = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
    });

    return {
      updated: settings.updatedLabel ?? vnYear,
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
        // exposed so the frontend can float freshly-added topics to the
        // front of the list — see the sort in index.html's render()
        createdAt: cat.createdAt,
        books: books
          .filter((b) => b.categoryId === cat.id)
          .map((b) => ({
            id: b.id,
            num: b.num,
            year: b.year,
            title: b.title,
            author: b.author,
            blurb: b.blurb,
            note: b.note,
            tags: b.tags,
            file: resolveAsset(b.fileUrl),
            cover: resolveAsset(b.coverUrl),
            readStatus: b.readStatus,
            favoritedBy: b.favoritedBy || [],
            // newest first — this is a running log of entries, not one
            // slot per person, so recency is the natural order
            reviews: (b.reviews || [])
              .slice()
              .sort(
                (a, c) =>
                  new Date(c.createdAt).getTime() -
                  new Date(a.createdAt).getTime(),
              )
              .map((r) => ({
                id: r.id,
                author: r.author,
                rating: r.rating,
                review: r.review,
                createdAt: r.createdAt,
              })),
            viewCount: b.viewCount,
            // "Mới" is computed on the frontend from this instead of a
            // stored flag — no cron/queue needed to expire it after a day
            createdAt: b.createdAt,
          })),
      })),
    };
  }
}
