import { Controller, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DiscordAlertService } from '../notifications/discord-alert.service';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly discordAlert: DiscordAlertService,
  ) {}

  @Get()
  get(@Req() req: Request) {
    // fire-and-forget — this is what actually catches "opened the site"
    // when the PIN form itself was skipped thanks to a cached JWT
    this.discordAlert
      .siteVisit({
        ip: req.ip || '',
        userAgent: req.headers['user-agent'] || '',
      })
      .catch(() => undefined);
    return this.catalogService.build();
  }
}
