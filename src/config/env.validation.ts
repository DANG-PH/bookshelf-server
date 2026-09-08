import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'development';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsIn(['postgres', 'mysql'])
  DB_TYPE: 'postgres' | 'mysql';

  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @IsInt()
  DB_PORT: number;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN: string = '7d';

  // Either AUTH_PIN (plain, dev-friendly) or AUTH_PIN_HASH (bcrypt, recommended
  // for anything reachable from the internet) must be set — checked at runtime
  // in AuthService rather than here, since exactly-one-of isn't expressible
  // cleanly with class-validator without a custom validator.
  @IsOptional()
  @IsString()
  AUTH_PIN?: string;

  @IsOptional()
  @IsString()
  AUTH_PIN_HASH?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGIN: string = '*';

  @IsOptional()
  @IsString()
  UPLOAD_DIR: string = './uploads';

  // Public base URL this API is reachable at (no trailing slash), used to
  // build absolute /api/files/... links in the /catalog response so the
  // static frontend (hosted elsewhere) can load PDFs/covers directly.
  @IsOptional()
  @IsString()
  PUBLIC_URL: string = '';

  // Optional — Discord webhook for login notifications. Leave unset to
  // disable (DiscordAlertService silently no-ops without it).
  @IsOptional()
  @IsString()
  DISCORD_WEBHOOK_URL?: string;

  // Optional — powers the /ai/ask library chatbot (RAG over the PDFs
  // already in the library). Leave unset and AiService just answers
  // "chatbot chưa được bật" instead of indexing/calling out to Gemini.
  @IsOptional()
  @IsString()
  GEMINI_API_KEY?: string;

  @IsOptional()
  @IsString()
  AI_SYSTEM_PROMPT?: string;

  // Optional — powers real push notifications (works even when the site
  // isn't open, like a native app). Leave unset and PushService just
  // silently skips sending — nothing else breaks. Generate a pair with
  // `npx web-push generate-vapid-keys` and never rotate it once devices
  // have subscribed, or they'll all need to re-subscribe from scratch.
  @IsOptional()
  @IsString()
  VAPID_PUBLIC_KEY?: string;

  @IsOptional()
  @IsString()
  VAPID_PRIVATE_KEY?: string;

  @IsOptional()
  @IsString()
  VAPID_SUBJECT?: string;

  // Optional — base URL of the pdf-translator sidecar container (see
  // docker-compose.yml and docs/vi-translate.md). Leave unset and the
  // "Biên dịch sang tiếng Việt" trigger just stays unavailable — nothing
  // else in the app depends on it.
  @IsOptional()
  @IsString()
  PDF_TRANSLATOR_URL?: string;

  // The same UPLOAD_DIR folder as seen from *inside* the pdf-translator
  // container, not this process — docker-compose.yml bind-mounts
  // UPLOAD_DIR there at this exact path, so a relative asset path like
  // "books/xxx.pdf" resolves to <this>/books/xxx.pdf on that side, vs
  // <UPLOAD_DIR>/books/xxx.pdf on this one. Only matters if
  // PDF_TRANSLATOR_URL is set.
  @IsOptional()
  @IsString()
  PDF_TRANSLATOR_UPLOAD_PATH: string = '/uploads';
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Config validation error:\n${errors.toString()}`);
  }

  if (!validatedConfig.AUTH_PIN && !validatedConfig.AUTH_PIN_HASH) {
    throw new Error(
      'Config validation error: set either AUTH_PIN or AUTH_PIN_HASH in .env',
    );
  }

  return validatedConfig;
}
