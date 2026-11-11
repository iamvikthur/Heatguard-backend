import type { Level } from '../ai/ai.client.js';

export const LEVEL_RANK: Record<Level, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

export type AlertReason = 'LEVEL_UP' | 'EASED' | 'SCHEDULE' | 'REMINDER';

/** The last crew alert that was sent: its level and the time it applied to. */
export interface CrewAlertState {
  level: Level;
  /** Work minutes per hour in that alert, when known. */
  workMin: number | null;
  at: Date;
  /** Each worker's last message text, so an unchanged message is not sent again. */
  workerBodies?: Map<string, string>;
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
  const interval = REMINDER_AFTER_MIN[level];
  if (interval === undefined) return null;
  return (at.getTime() - prev.at.getTime()) / 60000 >= interval ? 'REMINDER' : null;
}

export function actionFor(level: Level, workMin: number): string {
  if (level === 'RED') return workMin === 0 ? 'STOP' : 'REDUCE';
  if (level === 'ORANGE') return 'REDUCE';
  if (level === 'YELLOW') return 'REST';
  return 'HYDRATE';
}
