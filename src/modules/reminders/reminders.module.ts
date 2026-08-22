import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReminderState } from '../../database/entities/reminder-state.entity';
import { BooksModule } from '../books/books.module';
import { DiaryModule } from '../diary/diary.module';
import { MemoriesModule } from '../memories/memories.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemindersService } from './reminders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReminderState]),
    BooksModule,
    DiaryModule,
    MemoriesModule,
    NotificationsModule,
  ],
  providers: [RemindersService],
})
export class RemindersModule {}
