import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthController } from './../src/health.controller';

// Deliberately tests HealthController in isolation rather than the full
// AppModule — the full module needs a live database connection (see
// TypeOrmModule.forRootAsync in AppModule), which this smoke test
// shouldn't require just to check the app boots.
describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer()).get('/api/health').expect(200);
  });

  afterEach(async () => {
    await app.close();
  });
});
