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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DiaryService } from './diary.service';
import { CreateDiaryEntryDto } from './dto/create-diary-entry.dto';
import { QueryDiaryDto } from './dto/query-diary.dto';
import { UpdateDiaryEntryDto } from './dto/update-diary-entry.dto';

@ApiTags('diary')
@ApiBearerAuth()
@Controller('diary')
export class DiaryController {
  constructor(private readonly diaryService: DiaryService) {}

  @Get()
  findAll(@Query() query: QueryDiaryDto) {
    return this.diaryService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateDiaryEntryDto) {
    return this.diaryService.create(dto);
  }

  @Patch(':id/like')
  toggleLike(@Param('id', ParseUUIDPipe) id: string) {
    return this.diaryService.toggleLike(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiaryEntryDto,
  ) {
    return this.diaryService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.diaryService.remove(id);
  }
}
