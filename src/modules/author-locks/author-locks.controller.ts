import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthorLocksService } from './author-locks.service';
import { AuthorLockPasswordDto } from './dto/author-lock-password.dto';

@ApiTags('author-locks')
@ApiBearerAuth()
@Controller('author-locks')
export class AuthorLocksController {
  constructor(private readonly authorLocksService: AuthorLocksService) {}

  @Get(':author/status')
  status(@Param('author') author: string) {
    return this.authorLocksService.status(author);
  }

  @Post(':author/setup')
  async setup(
    @Param('author') author: string,
    @Body() dto: AuthorLockPasswordDto,
  ) {
    await this.authorLocksService.setup(author, dto.password);
    return { ok: true };
  }

  @Post(':author/verify')
  async verify(
    @Param('author') author: string,
    @Body() dto: AuthorLockPasswordDto,
  ) {
    await this.authorLocksService.verify(author, dto.password);
    return { ok: true };
  }

  // lives behind admin.html's "cài đặt nâng cao" as a way out of a
  // forgotten password — the shared site PIN already lets anyone reach
  // this, so it was never meant to withstand a determined partner
  @Delete(':author')
  @HttpCode(HttpStatus.NO_CONTENT)
  reset(@Param('author') author: string) {
    return this.authorLocksService.reset(author);
  }
}
