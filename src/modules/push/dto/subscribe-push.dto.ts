import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

class PushKeysDto {
  @ApiProperty()
  @IsString()
  p256dh: string;

  @ApiProperty()
  @IsString()
  auth: string;
}

// matches the shape of PushSubscription.toJSON() from the browser's
// Push API verbatim — nothing to reshape client-side. expirationTime
// has to be declared even though nothing here reads it: the global
// ValidationPipe runs with forbidNonWhitelisted, so any field the
// browser sends that isn't declared here gets the whole request
// rejected with 400 — every real subscribe attempt was failing on
// exactly this before it was added.
export class SubscribePushDto {
  @ApiProperty()
  @IsUrl()
  endpoint: string;

  @ApiPropertyOptional({
    description: 'Từ PushSubscription.toJSON() — thường là null',
  })
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;
}
