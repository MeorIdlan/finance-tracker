import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Trust the entire proxy chain. In production the only ingress path is
  // Cloudflare -> cloudflared -> nginx -> server, all infrastructure we
  // control with zero directly-exposed ports (see docker-compose.prod.yml).
  // There is no untrusted hop in front of nginx, so it's safe to trust the
  // full X-Forwarded-For chain and let Express resolve req.ip to the
  // original client address (leftmost entry) instead of the last hop's
  // container-internal socket address. Both the global and per-email
  // throttler guards read req.ip, so without this every external request
  // collapsed into a single IP bucket.
  app.set('trust proxy', true);
  app.setGlobalPrefix('api', {
    exclude: ['.well-known/oauth-authorization-server'],
  });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
