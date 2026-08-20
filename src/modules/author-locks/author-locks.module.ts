import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorLock } from '../../database/entities/author-lock.entity';
import { AuthorLocksController } from './author-locks.controller';
import { AuthorLocksService } from './author-locks.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuthorLock])],
  controllers: [AuthorLocksController],
  providers: [AuthorLocksService],
})
export class AuthorLocksModule {}
