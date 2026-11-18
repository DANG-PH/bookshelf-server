import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { basename, join, resolve } from 'path';
import { Public } from '../../common/decorators/public.decorator';

const ALLOWED_TYPES = ['books', 'covers'] as const;

@ApiTags('files')
@Controller('files')
export class FilesController {
  private readonly uploadDir: string;

  constructor(private readonly config: ConfigService) {
    this.uploadDir = resolve(
      this.config.get<string>('UPLOAD_DIR', './uploads'),
    );
  }

  // Public: the library itself is public (see GET /catalog), and plain
  // <img src> / <a href> tags can't send an auth header anyway.
  @Public()
  @Get(':type/:filename')
  serve(
    @Param('type') type: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!ALLOWED_TYPES.includes(type as (typeof ALLOWED_TYPES)[number])) {
      throw new BadRequestException('Loại file không hợp lệ');
    }

    // basename() strips any "../" segments so this can never escape uploadDir
    const safeName = basename(filename);
    const fullPath = join(this.uploadDir, type, safeName);

    if (!existsSync(fullPath)) {
      throw new NotFoundException('Không tìm thấy file');
    }

    res.sendFile(fullPath);
  }
}
