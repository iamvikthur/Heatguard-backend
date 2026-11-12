import { Injectable } from '@nestjs/common';
import type { ForecastPair, HourlyWeather } from './weather.types.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const PREVIOUS_RUNS_URL = 'https://previous-runs-api.open-meteo.com/v1/forecast';
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
export function parseHourly(payload: OpenMeteoResponse, suffix = ''): HourlyWeather[] {
  const hourly = payload.hourly;
  if (!hourly?.time) {
    throw new Error(`Open-Meteo response has no hourly data${payload.reason ? `: ${payload.reason}` : ''}`);
  }
  const num = (name: string, i: number): number | null => {
    const value = hourly[`${name}${suffix}`]?.[i];
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

/** Pairs each hour's 24-hour-ahead forecast (`_previous_day1` columns) with the latest values for that hour. */
export function parseForecastPairs(payload: OpenMeteoResponse): ForecastPair[] {
  const byTime = new Map<number, ForecastPair>();
  const entry = (validAt: Date) => {
    const existing = byTime.get(validAt.getTime());
    if (existing) return existing;
    const created: ForecastPair = { validAt, forecast: null, observed: null };
    byTime.set(validAt.getTime(), created);
    return created;
  };
  for (const row of parseHourly(payload, '_previous_day1')) entry(row.validAt).forecast = row;
  for (const row of parseHourly(payload)) entry(row.validAt).observed = row;
  return [...byTime.values()].sort((a, b) => a.validAt.getTime() - b.validAt.getTime());
}

@Injectable()
export class OpenMeteoClient {
  /**
   * For each hour between two UTC dates (YYYY-MM-DD, inclusive): the forecast made 24 hours
   * ahead and the latest value. For hours still in the future the latest value is itself a
   * forecast, so callers must not treat it as observed.
   */
  async fetchForecastPairs(latitude: number, longitude: number, startDate: string, endDate: string): Promise<ForecastPair[]> {
    const core = VARIABLES.filter((v) => v !== 'surface_pressure');
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      hourly: [...core, ...core.map((v) => `${v}_previous_day1`)].join(','),
      wind_speed_unit: 'ms',
      timezone: 'GMT',
      start_date: startDate,
      end_date: endDate,
    });
    const res = await fetch(`${PREVIOUS_RUNS_URL}?${params.toString()}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(`Open-Meteo previous runs responded ${res.status}`);
    }
    return parseForecastPairs((await res.json()) as OpenMeteoResponse);
  }


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
