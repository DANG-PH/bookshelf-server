import { Column, Entity, PrimaryColumn } from 'typeorm';

// singleton row (id fixed to 1) tracking when each kind of periodic
// reminder last actually fired — keeps RemindersService from repeating
// the same nudge every single day just because the underlying condition
// (a stalled book, a quiet diary, …) hasn't changed yet
@Entity('reminder_state')
export class ReminderState {
  @PrimaryColumn({ default: 1 })
  id: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastStalledBookAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastQuietDiaryAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastQuoteResurfaceAt: Date | null;
}
