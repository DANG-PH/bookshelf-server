import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DiscordAlertService } from '../discord-alert/discord-alert.service';

export interface LoginRequestMeta {
  ip: string;
  userAgent: string;
}

// AUTH_PIN / AUTH_PIN_HASH may each hold several comma-separated values
// so more than one admin PIN can be valid at once. bcrypt hashes never
// contain a comma, so splitting on it is unambiguous for both.
function splitList(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly discordAlert: DiscordAlertService,
  ) {}

  async login(
    pin: string,
    meta: LoginRequestMeta,
  ): Promise<{ accessToken: string; expiresIn: string }> {
    const valid = await this.verifyPin(pin);
    if (!valid) {
      // fire-and-forget: a Discord hiccup should never break the login flow
      this.discordAlert.loginFailed(meta).catch(() => undefined);
      throw new UnauthorizedException('Sai mã quản trị');
    }

    this.discordAlert.loginSuccess(meta).catch(() => undefined);

    const accessToken = await this.jwt.signAsync({ sub: 'admin' });
    return {
      accessToken,
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '7d'),
    };
  }

  private async verifyPin(pin: string): Promise<boolean> {
    const hashes = splitList(this.config.get<string>('AUTH_PIN_HASH'));
    if (hashes.length) {
      for (const hash of hashes) {
        if (await bcrypt.compare(pin, hash)) return true;
      }
      return false;
    }

    const plains = splitList(this.config.get<string>('AUTH_PIN'));
    if (plains.length) {
      return plains.includes(pin);
    }

    // env.validation guarantees one of the two is set; this is unreachable
    throw new InternalServerErrorException('AUTH_PIN chưa được cấu hình');
  }
}
