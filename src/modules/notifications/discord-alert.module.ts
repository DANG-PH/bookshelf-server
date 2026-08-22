import { Module } from '@nestjs/common';
import { DiscordAlertService } from './discord-alert.service';

// split out of NotificationsModule so PushModule can use DiscordAlertService
// too without creating a cycle (NotificationsModule already imports
// PushModule to relay in-app notifications out as push). NotificationsModule
// re-exports this module below so AuthModule/CatalogModule — which only
// ever wanted DiscordAlertService — don't need to change anything.
@Module({
  providers: [DiscordAlertService],
  exports: [DiscordAlertService],
})
export class DiscordAlertModule {}
