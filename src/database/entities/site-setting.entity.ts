import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// singleton row (id fixed to 1) holding the library's byline shown on the site
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

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
