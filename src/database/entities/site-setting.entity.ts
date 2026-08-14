import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// singleton row (id fixed to 1) holding the "curator" byline shown on the site
@Entity('site_settings')
export class SiteSetting {
  @PrimaryColumn({ default: 1 })
  id: number;

  @Column({ default: 'Thư Viện' })
  siteTitle: string;

  @Column({ nullable: true })
  curatorName: string;

  @Column({ nullable: true })
  curatorRole: string;

  @Column({ nullable: true })
  curatorPhoto: string;

  @Column({ nullable: true })
  updatedLabel: string;

  // display name for the "other" diary author — curatorName is already
  // the first author's name, this is the second one's
  @Column({ default: 'Vy' })
  partnerName: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
