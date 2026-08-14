import { Module } from '@nestjs/common';
import { DiscordAlertService } from './discord-alert.service';

@Module({
  providers: [DiscordAlertService],
  exports: [DiscordAlertService],
})
export class NotificationsModule {}
