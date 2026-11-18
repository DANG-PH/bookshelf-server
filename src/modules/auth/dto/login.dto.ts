import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'Mã PIN quản trị (4–12 ký tự)' })
  @IsString()
  @Length(4, 12)
  pin: string;
}
