import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { WeatherModule } from '../weather/weather.module.js';
import { RiskController } from './risk.controller.js';
import { RiskService } from './risk.service.js';

@Module({
  imports: [WeatherModule, AiModule],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
