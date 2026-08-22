import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class UnsubscribePushDto {
  @ApiProperty()
  @IsUrl()
  endpoint: string;
}
