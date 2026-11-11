import { Module } from '@nestjs/common';
import { AiClient } from './ai.client.js';

@Module({
  providers: [AiClient],
  exports: [AiClient],
})
export class AiModule {}
