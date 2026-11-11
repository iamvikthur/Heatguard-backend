import { actionFor, decideAlert } from './alert-rules.js';
import { messageLanguage, supervisorCrewMessage, supervisorEmergencyMessage, workerMessage } from './templates.js';

const at = (iso: string) => new Date(iso);

describe('decideAlert', () => {
  it('stays quiet on a first GREEN and alerts on a first higher level', () => {
    expect(decideAlert(null, 'GREEN', 60, at('2025-07-15T02:00:00Z'))).toBeNull();
    expect(decideAlert(null, 'ORANGE', 45, at('2025-07-15T02:00:00Z'))).toBe('LEVEL_UP');
  });

  it('alerts on every change of level, both ways', () => {
    const prev = { level: 'ORANGE' as const, workMin: 45, at: at('2025-07-15T02:00:00Z') };
    expect(decideAlert(prev, 'RED', 15, at('2025-07-15T02:15:00Z'))).toBe('LEVEL_UP');
    expect(decideAlert(prev, 'YELLOW', 60, at('2025-07-15T02:15:00Z'))).toBe('EASED');
  });

  it('alerts at once when the schedule changes within a level', () => {
    const prev = { level: 'ORANGE' as const, workMin: 45, at: at('2025-07-15T02:00:00Z') };
    expect(decideAlert(prev, 'ORANGE', 30, at('2025-07-15T03:00:00Z'))).toBe('SCHEDULE');
    expect(decideAlert(prev, 'ORANGE', 45, at('2025-07-15T03:00:00Z'))).toBeNull();
  });

  it('repeats an unchanged ORANGE after two hours and RED after one', () => {
    const orange = { level: 'ORANGE' as const, workMin: 30, at: at('2025-07-15T02:00:00Z') };
    expect(decideAlert(orange, 'ORANGE', 30, at('2025-07-15T03:45:00Z'))).toBeNull();
    expect(decideAlert(orange, 'ORANGE', 30, at('2025-07-15T04:00:00Z'))).toBe('REMINDER');
    const red = { level: 'RED' as const, workMin: 15, at: at('2025-07-15T07:00:00Z') };
    expect(decideAlert(red, 'RED', 15, at('2025-07-15T07:45:00Z'))).toBeNull();
    expect(decideAlert(red, 'RED', 15, at('2025-07-15T08:00:00Z'))).toBe('REMINDER');
  });

  it('never repeats GREEN or YELLOW', () => {
    const yellow = { level: 'YELLOW' as const, workMin: 60, at: at('2025-07-15T02:00:00Z') };
    expect(decideAlert(yellow, 'YELLOW', 60, at('2025-07-15T09:00:00Z'))).toBeNull();
  });

  it('falls back to the reminder rule when the last schedule is unknown', () => {
    const prev = { level: 'ORANGE' as const, workMin: null, at: at('2025-07-15T02:00:00Z') };
    expect(decideAlert(prev, 'ORANGE', 30, at('2025-07-15T02:15:00Z'))).toBeNull();
  });
});

describe('messages', () => {
  it('uses stop wording when no work is allowed', () => {
    expect(actionFor('RED', 0)).toBe('STOP');
    expect(workerMessage('en', 'RED', 0, 60)).toContain('Stop work now');
  });

  it('puts the schedule in the worker message', () => {
    expect(workerMessage('en', 'ORANGE', 30, 30)).toContain('work 30 min, then rest 30 min');
    expect(workerMessage('hi', 'ORANGE', 45, 15)).toContain('45');
    expect(workerMessage('ar', 'RED', 15, 45)).toContain('15');
  });

  it('falls back to English for languages without a template', () => {
    expect(messageLanguage('ml')).toBe('en');
    expect(workerMessage('bn', 'YELLOW', 60, 0)).toBe(workerMessage('en', 'YELLOW', 60, 0));
  });

  it('tells the supervisor about workers on a stricter schedule', () => {
    expect(supervisorCrewMessage('Crew C', 'ORANGE', 45, 15, 3, 'LEVEL_UP')).toBe(
      'Crew C: now ORANGE. Work 45 / rest 15 min per hour. 3 workers on a stricter schedule.',
    );
  });

  it('gives the emergency number in the supervisor emergency message', () => {
    expect(supervisorEmergencyMessage('W-031', 'Crew C', ['confusion'])).toContain('call 998');
  });
});
