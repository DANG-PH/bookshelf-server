import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from '../../database/entities/push-subscription.entity';
import { SubscribePushDto } from './dto/subscribe-push.dto';

export interface PushPayload {
  title: string;
  body: string;
  // where tapping the notification should open — a relative path like
  // "diary.html", falls back to the library home if omitted
  url?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly publicKey: string;
  private readonly configured: boolean;

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subsRepo: Repository<PushSubscription>,
    private readonly config: ConfigService,
  ) {
    this.publicKey = this.config.get<string>('VAPID_PUBLIC_KEY', '');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY', '');
    const subject = this.config.get<string>(
      'VAPID_SUBJECT',
      'mailto:admin@example.com',
    );
    this.configured = Boolean(this.publicKey && privateKey);
    if (this.configured) {
      webpush.setVapidDetails(subject, this.publicKey, privateKey);
    } else {
      this.logger.warn(
        '[Push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY chưa cấu hình — bỏ qua thông báo đẩy.',
      );
    }
  }

  getVapidPublicKey(): { publicKey: string; configured: boolean } {
    return { publicKey: this.publicKey, configured: this.configured };
  }

  async subscribe(dto: SubscribePushDto): Promise<void> {
    const existing = await this.subsRepo.findOne({
      where: { endpoint: dto.endpoint },
    });
    const entity = existing ?? this.subsRepo.create({ endpoint: dto.endpoint });
    entity.p256dh = dto.keys.p256dh;
    entity.auth = dto.keys.auth;
    await this.subsRepo.save(entity);
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.subsRepo.delete({ endpoint });
  }

  // fire-and-forget from NotificationsService — a push failure should
  // never block or fail the thing that triggered the notification.
  // Stale subscriptions (endpoint expired, browser data cleared, …) come
  // back as 404/410 from the push service; those get pruned automatically
  // instead of failing forever on every future notification.
  async sendToAll(payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    const subs = await this.subsRepo.find();
    if (!subs.length) return;

    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
          );
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.subsRepo.delete({ id: sub.id }).catch(() => undefined);
          } else {
            this.logger.warn(`[Push] Gửi thất bại: ${String(err)}`);
          }
        }
      }),
    );
  }
}
