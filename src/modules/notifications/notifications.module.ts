import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../../database/entities/notification.entity';
import { PushModule } from '../push/push.module';
import { DiscordAlertModule } from './discord-alert.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// two unrelated things share this module by name only: DiscordAlertService
// (pre-existing — login/visit alerts to a Discord webhook, used by
// AuthModule) and NotificationsService (the in-app bell). DiscordAlertService
// itself now lives in DiscordAlertModule (PushModule needs it too, and this
// module already imports PushModule, so keeping it here would cycle) —
// re-exported below so AuthModule/CatalogModule don't need to change what
// they import. Just don't let a future edit here drop either export while
// touching the other again.
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    PushModule,
    DiscordAlertModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService, DiscordAlertModule],
})
export class NotificationsModule {}
