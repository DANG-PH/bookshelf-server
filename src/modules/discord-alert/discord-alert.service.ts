import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

const COLOR = {
  GREEN: 0x2ecc71,
  ORANGE: 0xf39c12,
  BLUE: 0x3498db,
} as const;

const GEO_LOOKUP_TIMEOUT_MS = 3_000;
// one "someone is using the API" ping per device (IP + user agent) per
// window, not per request — opening the site fires a burst of requests
// (catalog, covers, PDFs) that should read as a single visit
const VISIT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h
// the de-dupe map is pruned once it grows past this, so a crawler cycling
// through many IPs can't grow it without bound
const VISIT_MAP_PRUNE_AT = 5_000;

// Access notifications, sent to a Discord webhook — the same shape as
// "new sign-in" emails from any mainstream app (when, what device, roughly
// where). Two kinds: any caller of the API (apiVisit, de-duplicated per
// device — see VISIT_COOLDOWN_MS), and admin PIN logins (every attempt).
@Injectable()
export class DiscordAlertService {
  private readonly logger = new Logger(DiscordAlertService.name);
  private readonly webhookUrl?: string;
  // in-memory de-dupe for apiVisit — fine to lose on restart, this is a
  // "someone is here right now" signal, not an audit log
  private readonly lastVisitAlertAt = new Map<string, number>();

  constructor(config: ConfigService) {
    this.webhookUrl = config.get<string>('DISCORD_WEBHOOK_URL');
  }

  // Called for every incoming API request (see main.ts); only the first
  // request from a given device within VISIT_COOLDOWN_MS actually sends.
  async apiVisit(meta: {
    ip: string;
    userAgent: string;
    method: string;
    path: string;
  }): Promise<void> {
    if (!this.webhookUrl) return;
    const now = Date.now();
    const key = `${meta.ip}::${meta.userAgent}`;
    const last = this.lastVisitAlertAt.get(key) || 0;
    if (now - last < VISIT_COOLDOWN_MS) return;
    this.lastVisitAlertAt.set(key, now);
    if (this.lastVisitAlertAt.size > VISIT_MAP_PRUNE_AT) {
      for (const [k, t] of this.lastVisitAlertAt) {
        if (now - t >= VISIT_COOLDOWN_MS) this.lastVisitAlertAt.delete(k);
      }
    }

    const location = await this.lookupLocation(meta.ip);
    await this.send('Có người đang dùng Thư Viện', COLOR.BLUE, [
      { name: 'Thời gian', value: this.nowVN(), inline: true },
      {
        name: 'Thiết bị',
        value: this.describeDevice(meta.userAgent),
        inline: true,
      },
      { name: 'IP', value: meta.ip || 'Không rõ', inline: true },
      { name: 'Vị trí (ước lượng theo IP)', value: location, inline: true },
      {
        name: 'Yêu cầu đầu tiên',
        value: `${meta.method} ${meta.path}`.slice(0, 200),
      },
      {
        name: 'User agent',
        value: (meta.userAgent || 'Không rõ').slice(0, 300),
      },
    ]);
  }

  async loginSuccess(meta: { ip: string; userAgent: string }): Promise<void> {
    const location = await this.lookupLocation(meta.ip);
    await this.send('Có người vừa đăng nhập trang quản trị', COLOR.GREEN, [
      { name: 'Thời gian', value: this.nowVN(), inline: true },
      {
        name: 'Thiết bị',
        value: this.describeDevice(meta.userAgent),
        inline: true,
      },
      { name: 'IP', value: meta.ip || 'Không rõ', inline: true },
      { name: 'Vị trí (ước lượng theo IP)', value: location, inline: true },
    ]);
  }

  async loginFailed(meta: { ip: string; userAgent: string }): Promise<void> {
    await this.send('Có người nhập sai mã quản trị', COLOR.ORANGE, [
      { name: 'Thời gian', value: this.nowVN(), inline: true },
      {
        name: 'Thiết bị',
        value: this.describeDevice(meta.userAgent),
        inline: true,
      },
      { name: 'IP', value: meta.ip || 'Không rõ', inline: true },
    ]);
  }

  private async send(
    title: string,
    color: number,
    fields: DiscordField[],
  ): Promise<void> {
    if (!this.webhookUrl) return; // not configured — silently skip
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            { title, color, timestamp: new Date().toISOString(), fields },
          ],
        }),
      });
    } catch (err) {
      this.logger.warn(`Gửi Discord alert thất bại: ${String(err)}`);
    }
  }

  private nowVN(): string {
    return new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
  }

  // Coarse only — "iPhone", "Android", "Mac", etc. Not a full user-agent
  // parser.
  private describeDevice(ua: string): string {
    if (!ua) return 'Không rõ';
    if (/iPhone/i.test(ua)) return 'iPhone (Safari)';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
    if (/Macintosh/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Thiết bị khác';
  }

  // City/country level only, via a free public GeoIP lookup — never
  // precise coordinates (nothing here could produce those anyway).
  private async lookupLocation(ip: string): Promise<string> {
    if (!ip || ip === '::1' || ip === '127.0.0.1' || this.isPrivateIp(ip)) {
      return 'Mạng nội bộ / localhost';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEO_LOOKUP_TIMEOUT_MS);
    try {
      const res = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,country`,
        { signal: controller.signal },
      );
      if (!res.ok) return 'Không xác định';
      const data = (await res.json()) as {
        status?: string;
        city?: string;
        country?: string;
      };
      if (data.status !== 'success') return 'Không xác định';
      return (
        [data.city, data.country].filter(Boolean).join(', ') || 'Không xác định'
      );
    } catch {
      return 'Không xác định';
    } finally {
      clearTimeout(timer);
    }
  }

  private isPrivateIp(ip: string): boolean {
    return /^(10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(ip);
  }
}
