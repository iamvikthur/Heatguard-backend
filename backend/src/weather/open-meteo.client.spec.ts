import { parseForecastPairs, parseHourly } from './open-meteo.client.js';

describe('parseHourly', () => {
  const payload = {
    hourly: {
      time: ['2026-07-15T07:00', '2026-07-15T08:00'],
      temperature_2m: [41.2, 42.7],
      relative_humidity_2m: [30, null],
      wind_speed_10m: [3.1, 3.6],
      shortwave_radiation: [800, 850],
      direct_radiation: [560, 600],
      surface_pressure: [1001.2, 1000.9],
    },
  };

  it('maps rows and reads timestamps as UTC', () => {
    const rows = parseHourly(payload);
    expect(rows[0].validAt.toISOString()).toBe('2026-07-15T07:00:00.000Z');
    expect(rows[0]).toMatchObject({ tempC: 41.2, humidityPct: 30, windMs: 3.1, radiationWm2: 800, directRadiationWm2: 560 });
  });

  it('drops hours with a missing core value', () => {
    expect(parseHourly(payload)).toHaveLength(1);
  });

  it('throws when there is no hourly block', () => {
    expect(() => parseHourly({ reason: 'bad request' })).toThrow('bad request');
  });
});

describe('parseForecastPairs', () => {
  it('pairs the 24-hour-ahead forecast with the latest value for each hour', () => {
    const pairs = parseForecastPairs({
      hourly: {
        time: ['2026-07-15T07:00', '2026-07-15T08:00'],
        temperature_2m: [41.2, 42.7],
        temperature_2m_previous_day1: [40.0, null],
        relative_humidity_2m: [30, 28],
        relative_humidity_2m_previous_day1: [35, 33],
        wind_speed_10m: [3.1, 3.6],
        wind_speed_10m_previous_day1: [2.9, 3.0],
        shortwave_radiation: [800, 850],
        shortwave_radiation_previous_day1: [780, 820],
        direct_radiation: [560, 600],
        direct_radiation_previous_day1: [540, 580],
      },
    });
    expect(pairs).toHaveLength(2);
    expect(pairs[0].forecast?.tempC).toBe(40);
    expect(pairs[0].observed?.tempC).toBe(41.2);
    expect(pairs[1].forecast).toBeNull();
    expect(pairs[1].observed?.tempC).toBe(42.7);
  });
});
