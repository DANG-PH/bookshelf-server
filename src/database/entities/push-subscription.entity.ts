import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

// one row per device that's opted into push notifications — not tied to
// "me"/"partner" the way diary entries are, since a subscription belongs
// to a browser/device, not a person. endpoint is unique per browser
// install, so re-subscribing the same device just updates its row.
@Entity('push_subscriptions')
@Unique(['endpoint'])
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  endpoint: string;

  @Column({ type: 'text' })
  p256dh: string;

  @Column({ type: 'text' })
  auth: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
