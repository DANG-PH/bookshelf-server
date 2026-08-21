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
import { ToggleBookFavoriteDto } from './dto/toggle-book-favorite.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { UpdateBookStatusDto } from './dto/update-book-status.dto';
import { CreateBookReviewDto } from './dto/create-book-review.dto';
import { CreateBookQuoteDto } from './dto/create-book-quote.dto';

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

  // plain-JSON PATCH, deliberately not behind FileFieldsInterceptor — this
  // is the one thing the site lets anyone browsing (not just whoever's
  // adding books) change directly from the reading view
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookStatusDto,
  ) {
    return this.booksService.updateStatus(id, dto);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  incrementView(@Param('id', ParseUUIDPipe) id: string) {
    return this.booksService.incrementView(id);
  }

  @Patch(':id/favorite')
  toggleFavorite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleBookFavoriteDto,
  ) {
    return this.booksService.toggleFavorite(id, dto.author);
  }

  @Post(':id/reviews')
  addReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBookReviewDto,
  ) {
    return this.booksService.addReview(id, dto);
  }

  @Delete(':id/reviews/:reviewId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
  ) {
    return this.booksService.deleteReview(id, reviewId);
  }

  @Post(':id/quotes')
  addQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBookQuoteDto,
  ) {
    return this.booksService.addQuote(id, dto);
  }

  @Delete(':id/quotes/:quoteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ) {
    return this.booksService.deleteQuote(id, quoteId);
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
