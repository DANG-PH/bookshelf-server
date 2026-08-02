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
