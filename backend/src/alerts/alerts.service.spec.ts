import type { PrismaService } from '../prisma/prisma.service.js';
import type { CrewAlertState } from './alert-rules.js';
import { AlertsService, type CrewNotification, type Schedule } from './alerts.service.js';

interface Stored {
  audience: string;
  reason: string;
  workerId: string | null;
  level: string;
}

function setup() {
  const stored: Stored[][] = [];
  const prisma = { alert: { createMany: async ({ data }: { data: Stored[] }) => void stored.push(data) } };
  return { service: new AlertsService(prisma as unknown as PrismaService), stored };
}

const ORANGE: Schedule = { level: 'ORANGE', workMin: 45, restMin: 15 };
const RED: Schedule = { level: 'RED', workMin: 15, restMin: 45 };

function hour(h: number, schedule: Schedule, overrides = new Map<string, Schedule>()): CrewNotification {
  return {
    assessmentId: `a${h}`,
    crew: { id: 'c1', name: 'Crew C' },
    workers: [
      { id: 'regular', language: 'en' },
      { id: 'newArrival', language: 'en' },
    ],
    schedule,
    overrides,
    at: new Date(Date.UTC(2025, 6, 15, h)),
    isReplay: true,
  };
}

describe('AlertsService.notifyCrew', () => {
  it('reminds a RED worker hourly while the ORANGE crew stays quiet', async () => {
    const { service, stored } = setup();
    const strict = new Map([['newArrival', RED]]);
    let state: CrewAlertState | null = null;

    ({ state } = await service.notifyCrew(hour(2, ORANGE, strict), state));
    expect(stored[0].map((a) => [a.audience, a.workerId, a.level])).toEqual([
      ['WORKER', 'regular', 'ORANGE'],
      ['WORKER', 'newArrival', 'RED'],
      ['SUPERVISOR', null, 'ORANGE'],
    ]);

    const second = await service.notifyCrew(hour(3, ORANGE, strict), state);
    expect(second.reason).toBeNull();
    expect(stored[1]).toHaveLength(1);
    expect(stored[1][0]).toMatchObject({ audience: 'WORKER', workerId: 'newArrival', reason: 'REMINDER' });
  });

  it('does not re-message a worker whose own schedule is unchanged when the crew goes up', async () => {
    const { service, stored } = setup();
    let state: CrewAlertState | null = null;
    ({ state } = await service.notifyCrew(hour(2, ORANGE, new Map([['newArrival', RED]])), state));
    const next = await service.notifyCrew({ ...hour(2, RED), at: new Date(Date.UTC(2025, 6, 15, 2, 30)) }, state);
    expect(next.reason).toBe('LEVEL_UP');
    expect(stored[1].map((a) => a.workerId)).toEqual(['regular', null]);
  });

  it('messages a new arrival above GREEN even when the crew is GREEN', async () => {
    const { service, stored } = setup();
    const green: Schedule = { level: 'GREEN', workMin: 60, restMin: 0 };
    const yellow: Schedule = { level: 'YELLOW', workMin: 60, restMin: 0 };
    const result = await service.notifyCrew(hour(2, green, new Map([['newArrival', yellow]])), null);
    expect(result.reason).toBeNull();
    expect(stored[0].map((a) => [a.audience, a.workerId])).toEqual([['WORKER', 'newArrival']]);
  });

  it('stores nothing when nobody needs a message', async () => {
    const { service, stored } = setup();
    const green: Schedule = { level: 'GREEN', workMin: 60, restMin: 0 };
    const result = await service.notifyCrew(hour(2, green), null);
    expect(result.sent).toBe(0);
    expect(stored).toHaveLength(0);
  });
});
