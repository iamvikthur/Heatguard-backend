import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { CheckinsController } from './checkins.controller.js';
import { CheckinsService } from './checkins.service.js';

@Module({
  imports: [AiModule, AlertsModule],
  controllers: [CheckinsController],
  providers: [CheckinsService],
})
export class CheckinsModule {}
