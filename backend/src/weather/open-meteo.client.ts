import { Injectable } from '@nestjs/common';
import type { HourlyWeather } from './weather.types.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const VARIABLES = [
  'temperature_2m',
  'relative_humidity_2m',
  'wind_speed_10m',
  'shortwave_radiation',
  'direct_radiation',
  'surface_pressure',
];

interface OpenMeteoResponse {
  hourly?: Record<string, (number | string | null)[]>;
  reason?: string;
}

/** Turns an Open-Meteo hourly block (GMT timestamps) into rows. Hours with a missing core value are dropped. */
export function parseHourly(payload: OpenMeteoResponse): HourlyWeather[] {
  const hourly = payload.hourly;
  if (!hourly?.time) {
    throw new Error(`Open-Meteo response has no hourly data${payload.reason ? `: ${payload.reason}` : ''}`);
  }
  const num = (name: string, i: number): number | null => {
    const value = hourly[name]?.[i];
    return typeof value === 'number' ? value : null;
  };
  const rows: HourlyWeather[] = [];
  hourly.time.forEach((time, i) => {
    const tempC = num('temperature_2m', i);
    const humidityPct = num('relative_humidity_2m', i);
    const windMs = num('wind_speed_10m', i);
    const radiationWm2 = num('shortwave_radiation', i);
    if (tempC === null || humidityPct === null || windMs === null || radiationWm2 === null) return;
    rows.push({
      validAt: new Date(`${String(time)}:00Z`),
      tempC,
      humidityPct,
      windMs,
      radiationWm2,
      directRadiationWm2: num('direct_radiation', i),
      pressureHpa: num('surface_pressure', i),
    });
  });
  return rows;
}

@Injectable()
export class OpenMeteoClient {
  /** Hourly forecast for today and tomorrow (UTC days) at a coordinate. */
  async fetchForecast(latitude: number, longitude: number): Promise<HourlyWeather[]> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      hourly: VARIABLES.join(','),
      wind_speed_unit: 'ms',
      timezone: 'GMT',
      forecast_days: '2',
    });
    const res = await fetch(`${FORECAST_URL}?${params.toString()}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`Open-Meteo responded ${res.status}`);
    }
    return parseHourly((await res.json()) as OpenMeteoResponse);
  }
}
