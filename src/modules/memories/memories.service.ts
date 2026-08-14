import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Memory } from '../../database/entities/memory.entity';
import { CreateMemoryDto } from './dto/create-memory.dto';

@Injectable()
export class MemoriesService {
  constructor(
    @InjectRepository(Memory)
    private readonly memoriesRepo: Repository<Memory>,
  ) {}

  findAll(): Promise<Memory[]> {
    // newest memory (by when it happened, falling back to when it was
    // added) first — a shared timeline reads top-to-bottom as "most recent"
    return this.memoriesRepo
      .createQueryBuilder('memory')
      .orderBy('COALESCE(memory.memoryDate, memory.createdAt)', 'DESC')
      .getMany();
  }

  create(dto: CreateMemoryDto): Promise<Memory> {
    const memory = this.memoriesRepo.create(dto);
    return this.memoriesRepo.save(memory);
  }

  async remove(id: string): Promise<void> {
    const memory = await this.memoriesRepo.findOne({ where: { id } });
    if (!memory) throw new NotFoundException('Không tìm thấy kỷ niệm này');
    await this.memoriesRepo.remove(memory);
  }
}
