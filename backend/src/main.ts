import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The web app runs on its own origin. Set WEB_ORIGIN in production (one
  // origin, or several separated by commas). Unset, any localhost port is
  // allowed, so a dev server on any port works without configuration.
  const allowed = (process.env.WEB_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowed.length > 0 ? allowed : /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  });

  const port = process.env.PORT || 5500; 

  await app.listen(port);
}
await bootstrap();
