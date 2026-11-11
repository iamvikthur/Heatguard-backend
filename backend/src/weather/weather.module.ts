import { Module } from '@nestjs/common';
import { OpenMeteoClient } from './open-meteo.client.js';

@Module({
  providers: [OpenMeteoClient],
  exports: [OpenMeteoClient],
})
export class WeatherModule {}
