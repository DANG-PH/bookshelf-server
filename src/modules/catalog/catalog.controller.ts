import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // the whole library, readable by anyone — no login needed to browse
  // and read books, only to add/edit them (see /books, admin-only)
  @Public()
  @Get()
  get() {
    return this.catalogService.build();
  }
}
