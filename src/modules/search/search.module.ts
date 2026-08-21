import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Book } from '../../database/entities/book.entity';
import { DiaryEntry } from '../../database/entities/diary-entry.entity';
import { Memory } from '../../database/entities/memory.entity';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [TypeOrmModule.forFeature([Book, DiaryEntry, Memory])],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
