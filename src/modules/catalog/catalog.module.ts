import { Module } from '@nestjs/common';
import { BooksModule } from '../books/books.module';
import { CategoriesModule } from '../categories/categories.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [CategoriesModule, BooksModule, SettingsModule, NotificationsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
