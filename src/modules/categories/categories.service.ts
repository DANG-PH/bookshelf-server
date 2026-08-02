import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../../database/entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepo: Repository<Category>,
  ) {}

  findAll(): Promise<Category[]> {
    return this.categoriesRepo.find({ order: { position: 'ASC' } });
  }

  async findOne(id: string): Promise<Category> {
    const category = await this.categoriesRepo.findOne({ where: { id } });
    if (!category) throw new NotFoundException('Không tìm thấy ngăn sách');
    return category;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    await this.assertSlugFree(dto.slug);
    const category = this.categoriesRepo.create(dto);
    return this.categoriesRepo.save(category);
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.findOne(id);
    if (dto.slug && dto.slug !== category.slug) {
      await this.assertSlugFree(dto.slug);
    }
    Object.assign(category, dto);
    return this.categoriesRepo.save(category);
  }

  async remove(id: string): Promise<void> {
    const category = await this.findOne(id);
    await this.categoriesRepo.remove(category);
  }

  private async assertSlugFree(slug: string): Promise<void> {
    const existing = await this.categoriesRepo.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException(`Slug "${slug}" đã tồn tại`);
    }
  }
}
