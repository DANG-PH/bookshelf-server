import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AuthorLockPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  password: string;
}
