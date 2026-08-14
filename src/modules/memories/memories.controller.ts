import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MemoriesService } from './memories.service';
import { CreateMemoryDto } from './dto/create-memory.dto';

@ApiTags('memories')
@ApiBearerAuth()
@Controller('memories')
export class MemoriesController {
  constructor(private readonly memoriesService: MemoriesService) {}

  @Get()
  findAll() {
    return this.memoriesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateMemoryDto) {
    return this.memoriesService.create(dto);
  }

  @Patch(':id/like')
  toggleLike(@Param('id', ParseUUIDPipe) id: string) {
    return this.memoriesService.toggleLike(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.memoriesService.remove(id);
  }
}
