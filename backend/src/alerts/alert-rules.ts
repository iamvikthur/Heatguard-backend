import type { Level } from '../ai/ai.client.js';

export const LEVEL_RANK: Record<Level, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

export type AlertReason = 'LEVEL_UP' | 'EASED' | 'SCHEDULE' | 'REMINDER';

/** The last crew alert that was sent: its level and the time it applied to. */
export interface CrewAlertState {
  level: Level;
  /** Work minutes per hour in that alert, when known. */
  workMin: number | null;
  at: Date;
  /** Each worker's last message and the time it applied to. */
  workers?: Map<string, WorkerMessageState>;
}

export interface WorkerMessageState {
  body: string;
  at: Date;
}

/** Minutes before the same level is repeated. Levels not listed are never repeated. */
export const REMINDER_AFTER_MIN: Partial<Record<Level, number>> = { ORANGE: 120, RED: 60 };

/**
 * Decides whether a crew gets an alert for its current level and schedule.
 * A change of level or of work minutes always alerts. An unchanged ORANGE or
 * RED is repeated only after its reminder interval, so workers are not
 * messaged on every run.
 */
export function decideAlert(prev: CrewAlertState | null, level: Level, workMin: number, at: Date): AlertReason | null {
  if (!prev) return level === 'GREEN' ? null : 'LEVEL_UP';
  if (LEVEL_RANK[level] > LEVEL_RANK[prev.level]) return 'LEVEL_UP';
  if (LEVEL_RANK[level] < LEVEL_RANK[prev.level]) return 'EASED';
  if (prev.workMin !== null && prev.workMin !== workMin) return 'SCHEDULE';
  return reminderDue(level, prev.at, at) ? 'REMINDER' : null;
}

/** True when an unchanged ORANGE or RED message is old enough to repeat. */
export function reminderDue(level: Level, lastAt: Date, at: Date): boolean {
  const interval = REMINDER_AFTER_MIN[level];
  return interval !== undefined && (at.getTime() - lastAt.getTime()) / 60000 >= interval;
}

/**
 * Decides whether one worker gets a message, judged on the worker's own
 * schedule: a first non-GREEN message, any change to their message, or a
 * reminder at their own level's interval (or whenever the crew is reminded).
 */
export function decideWorkerAlert(
  last: WorkerMessageState | undefined,
  level: Level,
  body: string,
  crewReason: AlertReason | null,
  at: Date,
): AlertReason | null {
  const change = crewReason && crewReason !== 'REMINDER' ? crewReason : null;
  if (!last) return level === 'GREEN' ? null : (change ?? 'LEVEL_UP');
  if (last.body !== body) return change ?? 'SCHEDULE';
  return crewReason === 'REMINDER' || reminderDue(level, last.at, at) ? 'REMINDER' : null;
}

export function actionFor(level: Level, workMin: number): string {
  if (level === 'RED') return workMin === 0 ? 'STOP' : 'REDUCE';
  if (level === 'ORANGE') return 'REDUCE';
  if (level === 'YELLOW') return 'REST';
  return 'HYDRATE';
}
