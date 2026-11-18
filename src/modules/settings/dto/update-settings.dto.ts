import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  siteTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  curatorName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  curatorRole?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  curatorPhoto?: string;

  @ApiPropertyOptional({ example: '2026' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  updatedLabel?: string;
}
