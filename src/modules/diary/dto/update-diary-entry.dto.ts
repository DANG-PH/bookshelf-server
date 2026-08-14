import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateDiaryEntryDto } from './create-diary-entry.dto';

// author isn't editable — an entry stays whoever originally wrote it
export class UpdateDiaryEntryDto extends PartialType(
  OmitType(CreateDiaryEntryDto, ['author'] as const),
) {}
