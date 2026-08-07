import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';

export interface BookLookupResult {
  title: string;
  author?: string;
  year?: number;
  cover?: string;
  workKey?: string;
}

const LOOKUP_TIMEOUT_MS = 8_000;
// e.g. "/works/OL19293745W" — the only shape Open Library ever returns for
// a work key, checked before it's interpolated into a URL we fetch server-side
const WORK_KEY_PATTERN = /^\/works\/OL\d+W$/;

// Wraps the Open Library API — free, keyless, no daily quota — used to
// autofill title/author/year/cover while adding a book. Proxied through the
// backend (rather than called directly from admin.html) so the browser
// never has to deal with a third party's CORS policy, and so this stays
// gated behind the same PIN-issued JWT as everything else.
@Injectable()
export class BookLookupService {
  private readonly baseUrl = 'https://openlibrary.org';

  async search(query: string): Promise<BookLookupResult[]> {
    const url = `${this.baseUrl}/search.json?q=${encodeURIComponent(query)}&limit=5&fields=title,author_name,first_publish_year,cover_i,key`;
    const res = await this.fetchWithTimeout(url);
    const data = (await res.json()) as {
      docs?: Array<{
        title?: string;
        author_name?: string[];
        first_publish_year?: number;
        cover_i?: number;
        key?: string;
      }>;
    };

    return (data.docs || [])
      .filter((d) => d.title)
      .map((d) => ({
        title: d.title as string,
        author: (d.author_name || []).join(', ') || undefined,
        year: d.first_publish_year,
        cover: d.cover_i
          ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
          : undefined,
        workKey: d.key,
      }));
  }

  async describe(workKey: string): Promise<{ blurb?: string }> {
    if (!WORK_KEY_PATTERN.test(workKey)) {
      throw new BadRequestException('workKey không hợp lệ');
    }
    const url = `${this.baseUrl}${workKey}.json`;
    const res = await this.fetchWithTimeout(url);
    const data = (await res.json()) as {
      description?: string | { value?: string };
    };
    const description =
      typeof data.description === 'string'
        ? data.description
        : data.description?.value;
    return { blurb: description ? description.slice(0, 500) : undefined };
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new BadGatewayException('Không tra được thông tin sách');
      }
      return res;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        'Không tra được thông tin sách (hết thời gian chờ hoặc mất kết nối)',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
