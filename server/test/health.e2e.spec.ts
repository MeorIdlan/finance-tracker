import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { startMemoryMongo } from './utils/mongo';

describe('GET /api/health', () => {
  let app: INestApplication;
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    process.env.MAILGUN_API_KEY = 'test-key';
    process.env.MAILGUN_DOMAIN = 'mg.test.com';
    process.env.MAILGUN_FROM_EMAIL = 'noreply@test.com';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  it('returns ok', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
