import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { DIARY_AUTHORS } from './create-diary-entry.dto';

export class ToggleLikeDto {
  @ApiProperty({
    enum: DIARY_AUTHORS,
    description: 'Ai đang bấm tym — chỉ tym của người này được bật/tắt',
  })
  @IsIn(DIARY_AUTHORS)
  author: (typeof DIARY_AUTHORS)[number];
}
