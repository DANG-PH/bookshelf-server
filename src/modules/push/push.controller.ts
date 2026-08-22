import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PushService } from './push.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { UnsubscribePushDto } from './dto/unsubscribe-push.dto';

@ApiTags('push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return this.pushService.getVapidPublicKey();
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribe(@Body() dto: SubscribePushDto) {
    return this.pushService.subscribe(dto);
  }

  @Delete('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(@Body() dto: UnsubscribePushDto) {
    return this.pushService.unsubscribe(dto.endpoint);
  }

  // diagnostic — sends one real push to every subscribed device right
  // now and reports exactly how many succeeded/failed and why, so
  // "does push actually work" is answerable from the API response
  // alone, no server log access needed
  @Post('test')
  test() {
    return this.pushService.sendToAll({
      title: 'Thử thông báo',
      body: 'Nếu thấy dòng này là thông báo đẩy đang hoạt động đúng rồi!',
    });
  }
}
