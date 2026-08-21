import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../../database/entities/notification.entity';
import { DiscordAlertService } from './discord-alert.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// two unrelated things share this module by name only: DiscordAlertService
// (pre-existing — login/visit alerts to a Discord webhook, used by
// AuthModule) and NotificationsService (the in-app bell). Kept together
// here rather than split apart since AuthModule already depends on this
// module for the former and that's how it was wired before the bell
// existed — just don't let a future edit here drop one while touching
// the other again.
@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  controllers: [NotificationsController],
  providers: [NotificationsService, DiscordAlertService],
  exports: [NotificationsService, DiscordAlertService],
})
export class NotificationsModule {}
