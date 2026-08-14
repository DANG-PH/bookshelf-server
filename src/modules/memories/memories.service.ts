import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Memory } from '../../database/entities/memory.entity';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { extractYouTubeId } from './youtube.util';

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
    const { youtubeUrl, ...rest } = dto;
    let youtubeId: string | undefined;
    if (youtubeUrl) {
      const id = extractYouTubeId(youtubeUrl);
      if (!id) {
        throw new BadRequestException(
          'Link YouTube không hợp lệ — dán link video hoặc ID 11 ký tự',
        );
      }
      youtubeId = id;
    }
    const memory = this.memoriesRepo.create({ ...rest, youtubeId });
    return this.memoriesRepo.save(memory);
  }

  async toggleLike(id: string, author: 'me' | 'partner'): Promise<Memory> {
    const memory = await this.findOne(id);
    const likedBy = new Set(memory.likedBy || []);
    if (likedBy.has(author)) likedBy.delete(author);
    else likedBy.add(author);
    memory.likedBy = [...likedBy];
    return this.memoriesRepo.save(memory);
  }

  async remove(id: string): Promise<void> {
    const memory = await this.findOne(id);
    await this.memoriesRepo.remove(memory);
  }

  private async findOne(id: string): Promise<Memory> {
    const memory = await this.memoriesRepo.findOne({ where: { id } });
    if (!memory) throw new NotFoundException('Không tìm thấy kỷ niệm này');
    return memory;
  }
}
