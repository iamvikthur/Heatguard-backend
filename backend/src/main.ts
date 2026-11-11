import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 5500; 

  await app.listen(port);
}
await bootstrap();
