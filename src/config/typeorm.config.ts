import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Book } from '../database/entities/book.entity';
import { BookQuote } from '../database/entities/book-quote.entity';
import { Category } from '../database/entities/category.entity';
import { SiteSetting } from '../database/entities/site-setting.entity';

export function buildTypeOrmConfig(
  config: ConfigService,
): TypeOrmModuleOptions {
  const common = {
    host: config.get<string>('DB_HOST'),
    port: config.get<number>('DB_PORT'),
    username: config.get<string>('DB_USERNAME'),
    password: config.get<string>('DB_PASSWORD'),
    database: config.get<string>('DB_NAME'),
    entities: [Category, Book, BookQuote, SiteSetting],
    // Fine for a small project managed by a couple of admins. Note that
    // synchronize only ever touches tables for the entities listed above —
    // tables from features that have since been removed are left as-is in
    // the database, never dropped automatically.
    // Switch to migrations if this ever needs to run against data you
    // can't afford to lose on a schema change.
    synchronize: true,
    autoLoadEntities: true,
  };

  const dbType = config.get<'postgres' | 'mysql'>('DB_TYPE');
  return dbType === 'mysql'
    ? { type: 'mysql', ...common }
    : { type: 'postgres', ...common };
}
