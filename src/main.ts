import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { mkdirSync } from 'fs';
import type { Express } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const uploadDir = config.get<string>('UPLOAD_DIR', './uploads');
  mkdirSync(`${uploadDir}/books`, { recursive: true });
  mkdirSync(`${uploadDir}/covers`, { recursive: true });

  // behind a single reverse-proxy hop (nginx) in production — without this,
  // req.ip resolves to nginx's own address instead of the real client's
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);

  // helmet's default Cross-Origin-Resource-Policy is "same-origin", which
  // silently blocks the browser from loading <img> tags whose src points
  // here — the frontend (book.dangpham.id.vn) and this API
  // (book-api.dangpham.id.vn) are different origins. That's invisible in
  // curl/Postman (CORP is a browser-enforced check, not a server-side
  // rejection) and doesn't break fetch()-based JSON calls (already CORS'd
  // above), only plain image embeds — which is exactly why diary/cover
  // photos failed to load with no visible error until now. GET /api/files
  // is already @Public() specifically to be embeddable this way.
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
      .setDescription('API cho thư viện sách cá nhân')
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
