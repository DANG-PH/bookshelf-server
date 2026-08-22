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

export interface PushSendResult {
  total: number;
  sent: number;
  failed: number;
  // one entry per failed subscription — endpoint host only (not the
  // full endpoint, which is effectively a secret) plus whatever the
  // push service said, so a failure is diagnosable without server logs
  errors: { endpointHost: string; error: string }[];
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

  // used by NotificationsService (fire-and-forget there — a push failure
  // should never block or fail the thing that triggered the
  // notification) and by the /push/test endpoint (which does read the
  // result, so a "did it actually work" check doesn't need server log
  // access). Stale subscriptions (expired endpoint, browser data
  // cleared, …) come back as 404/410 from the push service; those get
  // pruned automatically instead of failing forever on every future
  // notification.
  async sendToAll(payload: PushPayload): Promise<PushSendResult> {
    const subs = this.configured ? await this.subsRepo.find() : [];
    const result: PushSendResult = {
      total: subs.length,
      sent: 0,
      failed: 0,
      errors: [],
    };
    if (!this.configured || !subs.length) return result;

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
          result.sent++;
        } catch (err) {
          result.failed++;
          const statusCode = (err as { statusCode?: number }).statusCode;
          const message =
            (err as { body?: string; message?: string }).body ??
            (err as { message?: string }).message ??
            String(err);
          let endpointHost = '(endpoint không hợp lệ)';
          try {
            endpointHost = new URL(sub.endpoint).host;
          } catch {
            // leave the fallback above
          }
          result.errors.push({
            endpointHost,
            error: statusCode ? `HTTP ${statusCode}: ${message}` : message,
          });
          if (statusCode === 404 || statusCode === 410) {
            await this.subsRepo.delete({ id: sub.id }).catch(() => undefined);
          } else {
            this.logger.warn(`[Push] Gửi thất bại: ${String(err)}`);
          }
        }
      }),
    );
    return result;
  }
}
