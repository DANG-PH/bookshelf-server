import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiaryEntry } from '../../database/entities/diary-entry.entity';
import { DiaryController } from './diary.controller';
import { DiaryService } from './diary.service';

@Module({
  imports: [TypeOrmModule.forFeature([DiaryEntry])],
  controllers: [DiaryController],
  providers: [DiaryService],
})
export class DiaryModule {}
