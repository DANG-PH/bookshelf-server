import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateMemoryDto } from './create-memory.dto';

// who added it stays fixed, same reasoning as diary entries not letting
// you reassign the author
export class UpdateMemoryDto extends PartialType(
  OmitType(CreateMemoryDto, ['addedBy'] as const),
) {}
