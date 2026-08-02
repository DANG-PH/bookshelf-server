import { Module } from '@nestjs/common';
import { BooksModule } from '../books/books.module';
import { CategoriesModule } from '../categories/categories.module';
import { SettingsModule } from '../settings/settings.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [CategoriesModule, BooksModule, SettingsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
