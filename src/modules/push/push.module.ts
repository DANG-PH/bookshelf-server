import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushSubscription } from '../../database/entities/push-subscription.entity';
import { DiscordAlertModule } from '../notifications/discord-alert.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription]), DiscordAlertModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
