import { Module } from '@nestjs/common';
import { DiscordAlertService } from './discord-alert.service';

// admin-login alerts to a Discord webhook — optional, a no-op when
// DISCORD_WEBHOOK_URL isn't set
@Module({
  providers: [DiscordAlertService],
  exports: [DiscordAlertService],
})
export class DiscordAlertModule {}
