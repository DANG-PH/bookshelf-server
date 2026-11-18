import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { mkdirSync } from 'fs';
import type { Express, NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { DiscordAlertService } from './modules/discord-alert/discord-alert.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const uploadDir = config.get<string>('UPLOAD_DIR', './uploads');
  mkdirSync(`${uploadDir}/books`, { recursive: true });
  mkdirSync(`${uploadDir}/covers`, { recursive: true });

  // behind a single reverse-proxy hop (nginx) in production — without this,
  // req.ip resolves to nginx's own address instead of the real client's
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);

  // report every caller of the API to Discord (de-duplicated per device
  // inside DiscordAlertService) — the library is public, so this is how
  // the owner keeps an eye on who's using it. A plain Express middleware
  // rather than a Nest one so it sees everything, including unknown
  // routes (scanners), files and the view counter. CORS preflights and
  // the health check are skipped — they aren't a person visiting.
  const discordAlert = app.get(DiscordAlertService);
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.method !== 'OPTIONS' && req.path !== '/api/health') {
      discordAlert
        .apiVisit({
          ip: req.ip || '',
          userAgent: req.headers['user-agent'] || '',
          method: req.method,
          path: req.path,
        })
        .catch(() => undefined);
    }
    next();
  });

  // helmet's default Cross-Origin-Resource-Policy is "same-origin", which
  // silently blocks the browser from loading <img> tags whose src points
  // here — the frontend (book.dangpham.id.vn) and this API
  // (book-api.dangpham.id.vn) are different origins. That's invisible in
  // curl/Postman (CORP is a browser-enforced check, not a server-side
  // rejection) and doesn't break fetch()-based JSON calls (already CORS'd
  // above), only plain image embeds like book covers. GET /api/files is
  // @Public() specifically to be embeddable this way.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', '*'),
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Tech Books API')
      .setDescription(
        'API cho thư viện sách mở — đọc công khai, quản trị bằng mã PIN',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  console.log(`🚀 Tech Books API đang chạy tại http://localhost:${port}/api`);
}
void bootstrap();
