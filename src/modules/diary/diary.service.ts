import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiaryEntry } from '../../database/entities/diary-entry.entity';
import { CreateDiaryEntryDto } from './dto/create-diary-entry.dto';

@Injectable()
export class DiaryService {
  constructor(
    @InjectRepository(DiaryEntry)
    private readonly diaryRepo: Repository<DiaryEntry>,
  ) {}

  findAll(): Promise<DiaryEntry[]> {
    return this.diaryRepo.find({ order: { createdAt: 'DESC' } });
  }

  create(dto: CreateDiaryEntryDto): Promise<DiaryEntry> {
    const entry = this.diaryRepo.create(dto);
    return this.diaryRepo.save(entry);
  }

  async remove(id: string): Promise<void> {
    const entry = await this.diaryRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Không tìm thấy dòng nhật ký');
    await this.diaryRepo.remove(entry);
  }
}
