import { Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findRecent() {
    return this.notificationsService.findRecent();
  }

  @Patch('read-all')
  markAllRead() {
    return this.notificationsService.markAllRead();
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.markRead(id);
  }
}
