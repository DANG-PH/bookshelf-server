import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// a shared, mutually-visible timeline of moments — either person can add
// to it, unlike diary entries there's no per-author column gating anything
@Entity('memories')
export class Memory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // the date the moment actually happened, distinct from createdAt (when
  // it was added to the site) — lets old memories be added out of order
  @Column({ type: 'date', nullable: true })
  memoryDate: string;

  @Column({ nullable: true })
  photoUrl: string;

  @Column({ type: 'varchar', nullable: true })
  addedBy: 'me' | 'partner';

  @CreateDateColumn()
  createdAt: Date;
}
