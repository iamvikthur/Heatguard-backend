import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ForecastPair, HourlyWeather } from '../weather/weather.types.js';

/** Sites that data/pull_open_meteo.py downloads. Keep in step with that script. */
const REPLAY_SITES = [
  { slug: 'mussafah', latitude: 24.35, longitude: 54.5 },
  { slug: 'kizad', latitude: 24.72, longitude: 54.72 },
];

export function replaySlug(latitude: number, longitude: number): string | null {
  const match = REPLAY_SITES.find(
    (s) => Math.abs(s.latitude - latitude) < 0.01 && Math.abs(s.longitude - longitude) < 0.01,
  );
  return match?.slug ?? null;
}

/** Parses an observed_<site>_<yyyy-mm>.csv file and keeps the rows for one UTC date. */
export function parseObservedCsv(csv: string, date: string): HourlyWeather[] {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const columns = headerLine.split(',');
  const at = (name: string) => {
    const index = columns.indexOf(name);
    if (index === -1) throw new Error(`Replay file has no ${name} column`);
    return index;
  };
  const time = at('time');
  const temp = at('temperature_2m');
  const humidity = at('relative_humidity_2m');
  const wind = at('wind_speed_10m');
  const radiation = at('shortwave_radiation');
  const direct = at('direct_radiation');

  const rows: HourlyWeather[] = [];
  for (const line of lines) {
    const cells = line.split(',');
    if (!cells[time].startsWith(date)) continue;
    const values = [temp, humidity, wind, radiation].map((i) => Number(cells[i]));
    if (values.some((v) => !Number.isFinite(v)) || cells[temp] === '') continue;
    const directValue = Number(cells[direct]);
    rows.push({
      validAt: new Date(`${cells[time]}:00Z`),
      tempC: values[0],
      humidityPct: values[1],
      windMs: values[2],
      radiationWm2: values[3],
      directRadiationWm2: cells[direct] !== '' && Number.isFinite(directValue) ? directValue : null,
      pressureHpa: null,
    });
  }
  return rows;
}

/** Reads one day of observed weather from data/raw (REPLAY_DATA_DIR overrides the folder). */
export async function loadObservedDay(slug: string, date: string): Promise<HourlyWeather[]> {
  const dir = process.env.REPLAY_DATA_DIR ?? resolve(process.cwd(), '..', 'data', 'raw');
  const file = resolve(dir, `observed_${slug}_${date.slice(0, 7)}.csv`);
  let csv: string;
  try {
    csv = await readFile(file, 'utf8');
  } catch {
    throw new Error(`No replay data for ${slug} in ${date.slice(0, 7)}. Run data/pull_open_meteo.py first.`);
  }
  return parseObservedCsv(csv, date);
}

const CORE = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'shortwave_radiation', 'direct_radiation'];

/** Parses a data/raw CSV into rows, reading each variable with an optional column suffix. */
export function parseWeatherCsv(csv: string, suffix = ''): HourlyWeather[] {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const columns = headerLine.split(',');
  const time = columns.indexOf('time');
  const index = CORE.map((name) => columns.indexOf(`${name}${suffix}`));
  if (time === -1 || index.some((i) => i === -1)) {
    throw new Error(`Replay file is missing a ${suffix || 'weather'} column`);
  }
  const rows: HourlyWeather[] = [];
  for (const line of lines) {
    const cells = line.split(',');
    if (index.slice(0, 4).some((i) => cells[i] === '' || cells[i] === undefined)) continue;
    const [tempC, humidityPct, windMs, radiationWm2, direct] = index.map((i) => Number(cells[i]));
    if (![tempC, humidityPct, windMs, radiationWm2].every(Number.isFinite)) continue;
    rows.push({
      validAt: new Date(`${cells[time]}:00Z`),
      tempC,
      humidityPct,
      windMs,
      radiationWm2,
      directRadiationWm2: cells[index[4]] !== '' && Number.isFinite(direct) ? direct : null,
      pressureHpa: null,
    });
  }
  return rows;
}

/**
 * Forecast and observed weather from data/raw for every hour between two UTC dates
 * (YYYY-MM-DD, inclusive). Returns an empty list when a month's files are not there.
 */
export async function loadForecastPairs(slug: string, startDate: string, endDate: string): Promise<ForecastPair[]> {
  const dir = process.env.REPLAY_DATA_DIR ?? resolve(process.cwd(), '..', 'data', 'raw');
  const months: string[] = [];
  for (let d = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= endDate.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toISOString().slice(0, 7));
  }
  const byTime = new Map<number, ForecastPair>();
  const entry = (validAt: Date) => {
    const existing = byTime.get(validAt.getTime());
    if (existing) return existing;
    const created: ForecastPair = { validAt, forecast: null, observed: null };
    byTime.set(validAt.getTime(), created);
    return created;
  };
  for (const month of months) {
    let forecastCsv: string;
    let observedCsv: string;
    try {
      forecastCsv = await readFile(resolve(dir, `forecast_${slug}_${month}.csv`), 'utf8');
      observedCsv = await readFile(resolve(dir, `observed_${slug}_${month}.csv`), 'utf8');
    } catch {
      continue; // history may start before the downloaded summer; use what exists
    }
    for (const row of parseWeatherCsv(forecastCsv, '_previous_day1')) entry(row.validAt).forecast = row;
    for (const row of parseWeatherCsv(observedCsv)) entry(row.validAt).observed = row;
  }
  const from = Date.parse(`${startDate}T00:00:00Z`);
  const to = Date.parse(`${endDate}T23:59:59Z`);
  return [...byTime.values()]
    .filter((pair) => pair.validAt.getTime() >= from && pair.validAt.getTime() <= to)
    .sort((a, b) => a.validAt.getTime() - b.validAt.getTime());
}
