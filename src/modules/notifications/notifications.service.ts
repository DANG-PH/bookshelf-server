import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Notification } from '../../database/entities/notification.entity';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 50;

// backend-owned notification feed, shared by both people (no per-user
// rows — this is a 2-person site behind one PIN). Created from inside
// other services (a new book, a new shared-diary entry) rather than via
// a public endpoint, so the client can't forge arbitrary notifications —
// there's deliberately no POST route on the controller for this.
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepo: Repository<Notification>,
  ) {}

  async findRecent(): Promise<Notification[]> {
    await this.pruneOld();
    return this.notificationsRepo.find({
      order: { createdAt: 'DESC' },
      take: LIST_LIMIT,
    });
  }

  create(text: string): Promise<Notification> {
    const notification = this.notificationsRepo.create({ text });
    return this.notificationsRepo.save(notification);
  }

  async markRead(id: string): Promise<void> {
    await this.notificationsRepo.update({ id }, { read: true });
  }

  async markAllRead(): Promise<void> {
    await this.notificationsRepo.update({ read: false }, { read: true });
  }

  private async pruneOld(): Promise<void> {
    const cutoff = new Date(Date.now() - MAX_AGE_MS);
    await this.notificationsRepo.delete({ createdAt: LessThan(cutoff) });
  }
}
