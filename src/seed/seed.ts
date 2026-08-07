/**
 * One-off migration: imports the old tech-books/data.json (categories +
 * books) into the database, and copies the PDF/cover files it references
 * from the old static repo into ./uploads.
 *
 * Usage:  npm run seed  (or  npm run seed -- /path/to/data.json /path/to/static-repo)
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { existsSync, mkdirSync, promises as fs } from 'fs';
import { extname, join, resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { Category } from '../database/entities/category.entity';
import { Book } from '../database/entities/book.entity';
import { SiteSetting } from '../database/entities/site-setting.entity';

interface LegacyBook {
  num?: string;
  year?: number;
  title: string;
  author?: string;
  blurb?: string;
  tags?: string[];
  file: string;
  cover?: string;
  isNew?: boolean;
}

interface LegacyCategory {
  id: string;
  folder?: string;
  title: string;
  dewey?: string;
  range?: string;
  intro?: string;
  books: LegacyBook[];
}

interface LegacyData {
  updated?: string;
  curator?: { name?: string; role?: string; photo?: string };
  categories: LegacyCategory[];
}

function resolveLegacyPath(cat: LegacyCategory, name: string): string {
  if (!name) return '';
  if (name.includes('://') || name.startsWith('/') || name.includes('/')) {
    return name;
  }
  return cat.folder ? `${cat.folder}/${name}` : name;
}

async function copyIfLocal(
  staticRepoDir: string,
  uploadDir: string,
  subfolder: 'books' | 'covers',
  relativeOrUrl: string,
): Promise<string | undefined> {
  if (!relativeOrUrl) return undefined;
  if (/^https?:\/\//i.test(relativeOrUrl)) return relativeOrUrl; // keep external URLs as-is

  const src = resolve(staticRepoDir, relativeOrUrl);
  if (!existsSync(src)) {
    console.warn(`  ⚠ không tìm thấy file "${relativeOrUrl}", bỏ qua`);
    return undefined;
  }

  const destName = `${uuidv4()}${extname(src).toLowerCase()}`;
  const destPath = join(uploadDir, subfolder, destName);
  await fs.copyFile(src, destPath);
  return `${subfolder}/${destName}`;
}

// Where seed data is looked for when no path is given on the command line,
// in order of preference:
//   1. ./seed-data/data.json — bundled in this repo, always available right
//      after `git clone` on a fresh server. This is what makes `npm run seed`
//      work out of the box in production.
//   2. ../tech-books/data.json — the original static site repo, handy for
//      local dev if you're editing that repo directly and want to re-import.
function defaultDataPath(): string | undefined {
  const bundled = resolve(process.cwd(), 'seed-data/data.json');
  if (existsSync(bundled)) return bundled;

  const sibling = resolve(process.cwd(), '../tech-books/data.json');
  if (existsSync(sibling)) return sibling;

  return undefined;
}

async function run() {
  const [, , dataPathArg, staticRepoArg] = process.argv;
  const dataPath = dataPathArg ? resolve(dataPathArg) : defaultDataPath();

  if (!dataPath || !existsSync(dataPath)) {
    console.error(
      'Không tìm thấy data.json (đã thử ./seed-data/data.json và ../tech-books/data.json).',
    );
    console.error(
      'Chạy: npm run seed -- /duong/dan/toi/data.json /duong/dan/toi/tech-books',
    );
    process.exit(1);
  }
  const staticRepoDir = resolve(staticRepoArg ?? join(dataPath, '..'));

  const raw = await fs.readFile(dataPath, 'utf-8');
  const data = JSON.parse(raw) as LegacyData;

  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const uploadDir = resolve(config.get<string>('UPLOAD_DIR', './uploads'));
  mkdirSync(join(uploadDir, 'books'), { recursive: true });
  mkdirSync(join(uploadDir, 'covers'), { recursive: true });

  const categoryRepo: Repository<Category> = app.get(
    getRepositoryToken(Category),
  );
  const bookRepo: Repository<Book> = app.get(getRepositoryToken(Book));
  const settingsRepo: Repository<SiteSetting> = app.get(
    getRepositoryToken(SiteSetting),
  );

  console.log(`Đang import từ ${dataPath}`);
  console.log(`File tĩnh (pdf/cover) đọc từ ${staticRepoDir}`);

  if (data.curator?.name) {
    await settingsRepo.save(
      settingsRepo.create({
        id: 1,
        curatorName: data.curator.name,
        curatorRole: data.curator.role,
        curatorPhoto: data.curator.photo,
        updatedLabel: data.updated,
      }),
    );
    console.log(`✓ Cập nhật curator: ${data.curator.name}`);
  }

  for (const [index, cat] of data.categories.entries()) {
    let category = await categoryRepo.findOne({ where: { slug: cat.id } });
    if (!category) {
      category = await categoryRepo.save(
        categoryRepo.create({
          slug: cat.id,
          title: cat.title,
          dewey: cat.dewey,
          range: cat.range,
          intro: cat.intro,
          position: index,
        }),
      );
      console.log(`✓ Tạo ngăn "${cat.title}" (${cat.id})`);
    } else {
      console.log(`= Ngăn "${cat.title}" (${cat.id}) đã tồn tại, dùng lại`);
    }

    for (const b of cat.books ?? []) {
      const exists = await bookRepo.findOne({
        where: { categoryId: category.id, title: b.title },
      });
      if (exists) {
        console.log(`  = "${b.title}" đã có, bỏ qua`);
        continue;
      }

      const fileUrl = await copyIfLocal(
        staticRepoDir,
        uploadDir,
        'books',
        resolveLegacyPath(cat, b.file),
      );
      if (!fileUrl) {
        console.warn(`  ⚠ bỏ qua "${b.title}" vì không copy được file PDF`);
        continue;
      }

      const coverUrl = b.cover
        ? await copyIfLocal(
            staticRepoDir,
            uploadDir,
            'covers',
            resolveLegacyPath(cat, b.cover),
          )
        : undefined;

      await bookRepo.save(
        bookRepo.create({
          categoryId: category.id,
          num: b.num,
          year: b.year,
          title: b.title,
          author: b.author,
          blurb: b.blurb,
          tags: b.tags,
          fileUrl,
          coverUrl,
        }),
      );
      console.log(`  ✓ "${b.title}"`);
    }
  }

  await app.close();
  console.log('Xong.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
