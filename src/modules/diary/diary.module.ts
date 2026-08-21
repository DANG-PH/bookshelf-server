import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiaryEntry } from '../../database/entities/diary-entry.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { DiaryController } from './diary.controller';
import { DiaryService } from './diary.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DiaryEntry]),
    NotificationsModule,
    SettingsModule,
  ],
  controllers: [DiaryController],
  providers: [DiaryService],
})
export class DiaryModule {}
