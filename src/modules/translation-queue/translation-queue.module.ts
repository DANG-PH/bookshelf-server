import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Book } from '../../database/entities/book.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { TranslationWorkerService } from './translation-worker.service';

@Module({
  imports: [TypeOrmModule.forFeature([Book]), NotificationsModule],
  providers: [TranslationWorkerService],
  // exported so BooksService can nudge the worker to check right away
  // when a job is freshly queued, instead of only ever finding out on
  // the next @Cron tick — see poll() and its call site
  exports: [TranslationWorkerService],
})
export class TranslationQueueModule {}
