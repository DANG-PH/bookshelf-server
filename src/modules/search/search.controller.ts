import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SearchResults, SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query('q') q?: string): Promise<SearchResults> | SearchResults {
    const query = (q || '').trim();
    if (query.length < 2) return { books: [], diary: [], memories: [] };
    return this.searchService.search(query);
  }
}
