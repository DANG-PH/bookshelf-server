import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { MEMORY_AUTHORS } from './create-memory.dto';

export class ToggleLikeDto {
  @ApiProperty({
    enum: MEMORY_AUTHORS,
    description: 'Ai đang bấm tym — chỉ tym của người này được bật/tắt',
  })
  @IsIn(MEMORY_AUTHORS)
  author: (typeof MEMORY_AUTHORS)[number];
}
