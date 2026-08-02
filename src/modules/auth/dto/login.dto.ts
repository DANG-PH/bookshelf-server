import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '010826', description: '6-digit PIN' })
  @IsString()
  @Length(4, 12)
  pin: string;
}
