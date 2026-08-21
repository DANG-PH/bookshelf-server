import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { DiaryService } from './diary.service';
import { CreateDiaryEntryDto } from './dto/create-diary-entry.dto';
import { QueryDiaryDto } from './dto/query-diary.dto';
import { QueryPrivateDiaryDto } from './dto/query-private-diary.dto';
import { ToggleLikeDto } from './dto/toggle-like.dto';
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

  // uploads the photo first, separately from creating/updating the entry
  // itself — the entry endpoints stay plain JSON, this just hands back a
  // photoUrl to include in that body, same two-step flow admin.html
  // already uses for book covers
  @Post('upload-photo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('photo'))
  uploadPhoto(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Thiếu file ảnh');
    return { photoUrl: this.diaryService.resolvePhotoUrl(file.filename) };
  }

  // "Nhật ký riêng" — must come before the generic ':id' routes below so
  // Nest doesn't try to parse "private" as a UUID
  @Get('private')
  findAllPrivate(@Query() query: QueryPrivateDiaryDto) {
    return this.diaryService.findAllPrivate(query);
  }

  @Post('private')
  createPrivate(@Body() dto: CreateDiaryEntryDto) {
    return this.diaryService.createPrivate(dto);
  }

  // same reason this has to sit above ':id' — "on-this-day" would
  // otherwise get parsed as a UUID param
  @Get('on-this-day')
  onThisDay() {
    return this.diaryService.onThisDay();
  }

  @Patch(':id/like')
  toggleLike(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleLikeDto,
  ) {
    return this.diaryService.toggleLike(id, dto.author);
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
