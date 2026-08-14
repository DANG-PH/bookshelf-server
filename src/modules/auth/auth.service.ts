import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DiscordAlertService } from '../notifications/discord-alert.service';

export interface LoginRequestMeta {
  ip: string;
  userAgent: string;
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
      throw new UnauthorizedException('Sai mã PIN');
    }

    this.discordAlert.loginSuccess(meta).catch(() => undefined);

    const accessToken = await this.jwt.signAsync({ sub: 'curator' });
    return {
      accessToken,
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '7d'),
    };
  }

  private async verifyPin(pin: string): Promise<boolean> {
    const hash = this.config.get<string>('AUTH_PIN_HASH');
    if (hash) {
      return bcrypt.compare(pin, hash);
    }

    const plain = this.config.get<string>('AUTH_PIN');
    if (plain) {
      return pin === plain;
    }

    // env.validation guarantees one of the two is set; this is unreachable
    throw new InternalServerErrorException('AUTH_PIN chưa được cấu hình');
  }
}
