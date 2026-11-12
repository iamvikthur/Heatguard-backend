import { parseObservedCsv, parseWeatherCsv, replaySlug } from './replay-data.js';

const CSV = [
  'time,temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation,direct_radiation,diffuse_radiation',
  '2025-07-14T23:00,33.1,60,2.1,0.0,0.0,0.0',
  '2025-07-15T00:00,30.9,75,1.48,0.0,0.0,0.0',
  '2025-07-15T08:00,46.8,14,0.85,858.0,591.0,267.0',
  '2025-07-15T09:00,,14,0.85,858.0,591.0,267.0',
  '2025-07-16T00:00,31.0,70,1.5,0.0,0.0,0.0',
].join('\n');

describe('parseObservedCsv', () => {
  it('keeps only the requested UTC date and skips incomplete rows', () => {
    const rows = parseObservedCsv(CSV, '2025-07-15');
    expect(rows.map((r) => r.validAt.toISOString())).toEqual([
      '2025-07-15T00:00:00.000Z',
      '2025-07-15T08:00:00.000Z',
    ]);
    expect(rows[1]).toMatchObject({ tempC: 46.8, humidityPct: 14, windMs: 0.85, radiationWm2: 858, directRadiationWm2: 591 });
  });

  it('rejects a file without the expected columns', () => {
    expect(() => parseObservedCsv('time,foo\n2025-07-15T00:00,1', '2025-07-15')).toThrow('temperature_2m');
  });
});

describe('replaySlug', () => {
  it('matches the seeded sites by coordinates', () => {
    expect(replaySlug(24.35, 54.5)).toBe('mussafah');
    expect(replaySlug(24.72, 54.72)).toBe('kizad');
    expect(replaySlug(0, 0)).toBeNull();
  });
});

describe('parseWeatherCsv', () => {
  const forecast = [
    'time,temperature_2m,temperature_2m_previous_day1,relative_humidity_2m,relative_humidity_2m_previous_day1,wind_speed_10m,wind_speed_10m_previous_day1,shortwave_radiation,shortwave_radiation_previous_day1,direct_radiation,direct_radiation_previous_day1',
    '2025-07-01T12:00,42.7,38.2,18,39,3.59,4.22,632.0,649.0,418.0,481.0',
    '2025-07-01T13:00,42.0,,20,40,3.0,4.0,500.0,510.0,300.0,310.0',
  ].join('\n');

  it('reads the 24-hour-ahead columns when given their suffix', () => {
    const rows = parseWeatherCsv(forecast, '_previous_day1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tempC: 38.2, humidityPct: 39, windMs: 4.22, radiationWm2: 649, directRadiationWm2: 481 });
  });

  it('reads the plain columns without a suffix', () => {
    expect(parseWeatherCsv(forecast)).toHaveLength(2);
    expect(parseWeatherCsv(forecast)[0].tempC).toBe(42.7);
  });

  it('rejects a file without the requested columns', () => {
    expect(() => parseWeatherCsv('time,temperature_2m\n2025-07-01T12:00,40', '_previous_day1')).toThrow('missing');
  });
});
