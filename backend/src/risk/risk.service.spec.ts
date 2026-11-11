import { coversTimeOfDay } from './risk.service.js';

describe('coversTimeOfDay', () => {
  const shift = { startsAt: new Date('2026-11-12T02:00:00Z'), endsAt: new Date('2026-11-12T10:00:00Z') };

  it('matches hours inside the shift window on any date', () => {
    expect(coversTimeOfDay(shift, new Date('2025-07-15T02:00:00Z'))).toBe(true);
    expect(coversTimeOfDay(shift, new Date('2025-07-15T09:00:00Z'))).toBe(true);
  });

  it('excludes the end hour and hours outside the window', () => {
    expect(coversTimeOfDay(shift, new Date('2025-07-15T10:00:00Z'))).toBe(false);
    expect(coversTimeOfDay(shift, new Date('2025-07-15T01:00:00Z'))).toBe(false);
  });

  it('handles shifts that cross midnight', () => {
    const night = { startsAt: new Date('2026-11-12T20:00:00Z'), endsAt: new Date('2026-11-13T04:00:00Z') };
    expect(coversTimeOfDay(night, new Date('2025-07-15T23:00:00Z'))).toBe(true);
    expect(coversTimeOfDay(night, new Date('2025-07-15T03:00:00Z'))).toBe(true);
    expect(coversTimeOfDay(night, new Date('2025-07-15T04:00:00Z'))).toBe(false);
  });
});
