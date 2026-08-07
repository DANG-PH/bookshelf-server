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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { BookLookupService } from './book-lookup.service';
import { BooksService } from './books.service';
import type { UploadedBookFiles } from './books.service';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';

const UPLOAD_FIELDS = [
  { name: 'file', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
];

@ApiTags('books')
@ApiBearerAuth()
@Controller('books')
export class BooksController {
  constructor(
    private readonly booksService: BooksService,
    private readonly bookLookupService: BookLookupService,
  ) {}

  @Get()
  findAll(@Query('categoryId') categoryId?: string) {
    return this.booksService.findAll(categoryId);
  }

  // must stay ahead of the ":id" route below, or "/books/lookup" would be
  // parsed as a (invalid) book id instead of matching this route
  @Get('lookup')
  lookup(@Query('q') q?: string) {
    const query = (q || '').trim();
    if (query.length < 2) return [];
    return this.bookLookupService.search(query);
  }

  @Get('lookup/detail')
  lookupDetail(@Query('workKey') workKey: string) {
    return this.bookLookupService.describe(workKey);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.booksService.findOne(id);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileFieldsInterceptor(UPLOAD_FIELDS))
  create(
    @Body() dto: CreateBookDto,
    @UploadedFiles() files: UploadedBookFiles,
  ) {
    return this.booksService.create(dto, files ?? {});
  }

  @Patch(':id')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileFieldsInterceptor(UPLOAD_FIELDS))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookDto,
    @UploadedFiles() files: UploadedBookFiles,
  ) {
    return this.booksService.update(id, dto, files ?? {});
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.booksService.remove(id);
  }
}
