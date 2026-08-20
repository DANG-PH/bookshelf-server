import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { AuthorLock } from '../../database/entities/author-lock.entity';

const VALID_AUTHORS = ['me', 'partner'];

@Injectable()
export class AuthorLocksService {
  constructor(
    @InjectRepository(AuthorLock)
    private readonly authorLocksRepo: Repository<AuthorLock>,
  ) {}

  private assertValidAuthor(author: string): void {
    if (!VALID_AUTHORS.includes(author)) {
      throw new BadRequestException('author không hợp lệ');
    }
  }

  async status(author: string): Promise<{ configured: boolean }> {
    this.assertValidAuthor(author);
    const row = await this.authorLocksRepo.findOne({ where: { author } });
    return { configured: Boolean(row) };
  }

  async setup(author: string, password: string): Promise<void> {
    this.assertValidAuthor(author);
    const existing = await this.authorLocksRepo.findOne({ where: { author } });
    if (existing) {
      throw new ConflictException('Đã có mật khẩu riêng cho người này rồi');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.authorLocksRepo.save(
      this.authorLocksRepo.create({ author, passwordHash }),
    );
  }

  async verify(author: string, password: string): Promise<void> {
    this.assertValidAuthor(author);
    const row = await this.authorLocksRepo.findOne({ where: { author } });
    if (!row) {
      throw new NotFoundException('Chưa đặt mật khẩu riêng cho người này');
    }
    const ok = await bcrypt.compare(password, row.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Sai mật khẩu');
    }
  }

  async reset(author: string): Promise<void> {
    this.assertValidAuthor(author);
    await this.authorLocksRepo.delete({ author });
  }
}
