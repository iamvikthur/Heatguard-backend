import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { WeatherModule } from '../weather/weather.module.js';
import { PlanController } from './plan.controller.js';
import { PlanService } from './plan.service.js';

@Module({
  imports: [AiModule, WeatherModule],
  controllers: [PlanController],
  providers: [PlanService],
})
export class PlanModule {}
