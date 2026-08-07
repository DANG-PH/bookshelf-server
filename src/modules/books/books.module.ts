import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  bookAssetsFileFilter,
  bookAssetsStorage,
  MAX_PDF_SIZE_BYTES,
} from '../../common/utils/storage';
import { Book } from '../../database/entities/book.entity';
import { CategoriesModule } from '../categories/categories.module';
import { BookLookupService } from './book-lookup.service';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Book]),
    CategoriesModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: bookAssetsStorage(
          config.get<string>('UPLOAD_DIR', './uploads'),
        ),
        fileFilter: bookAssetsFileFilter,
        limits: { fileSize: MAX_PDF_SIZE_BYTES },
      }),
    }),
  ],
  controllers: [BooksController],
  providers: [BooksService, BookLookupService],
  exports: [BooksService],
})
export class BooksModule {}
