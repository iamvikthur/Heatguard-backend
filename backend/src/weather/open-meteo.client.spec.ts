import { parseHourly } from './open-meteo.client.js';

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
