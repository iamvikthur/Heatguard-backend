import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The web app runs on its own origin. WEB_ORIGIN overrides the local default.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });

  const port = process.env.PORT || 5500; 

  await app.listen(port);
}
await bootstrap();
