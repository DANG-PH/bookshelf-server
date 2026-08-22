import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  imageAssetStorage,
  imageFileFilter,
  MAX_IMAGE_SIZE_BYTES,
} from '../../common/utils/storage';
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
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: imageAssetStorage(
          config.get<string>('UPLOAD_DIR', './uploads'),
          'diary',
        ),
        fileFilter: imageFileFilter,
        limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
      }),
    }),
  ],
  controllers: [DiaryController],
  providers: [DiaryService],
  exports: [DiaryService],
})
export class DiaryModule {}
