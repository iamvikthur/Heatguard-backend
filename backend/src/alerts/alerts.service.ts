import { Injectable, NotFoundException } from '@nestjs/common';
import type { Level } from '../ai/ai.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { actionFor, decideAlert, type AlertReason, type CrewAlertState } from './alert-rules.js';
import {
  messageLanguage,
  supervisorCrewMessage,
  supervisorEmergencyMessage,
  workerEmergencyMessage,
  workerMessage,
} from './templates.js';

export interface Schedule {
  level: Level;
  workMin: number;
  restMin: number;
}

export interface CrewNotification {
  assessmentId: string;
  crew: { id: string; name: string };
  workers: { id: string; language: string }[];
  schedule: Schedule;
  /** Workers whose own schedule is stricter than the crew's. */
  overrides: Map<string, Schedule>;
  /** The time the assessment applies to. */
  at: Date;
  isReplay: boolean;
}

/**
 * Delivery in the prototype is the in-app inbox only (channel APP), so an alert
 * is marked SENT as soon as it is stored. Real SMS or WhatsApp delivery would
 * set the status from the provider's response instead.
 */
@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The last live (non-replay) heat alert sent for a crew. */
  async lastCrewState(crewId: string): Promise<CrewAlertState | null> {
    const last = await this.prisma.alert.findFirst({
      where: { crewId, audience: 'SUPERVISOR', isReplay: false, reason: { not: 'RED_FLAG' } },
      orderBy: { createdAt: 'desc' },
      select: { level: true, validAt: true, assessment: { select: { workMin: true } } },
    });
    return last ? { level: last.level, workMin: last.assessment?.workMin ?? null, at: last.validAt } : null;
  }

  /** The text of each worker's most recent live heat message. */
  private async lastWorkerBodies(workerIds: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.alert.findMany({
      where: { workerId: { in: workerIds }, audience: 'WORKER', isReplay: false, reason: { not: 'RED_FLAG' } },
      orderBy: { createdAt: 'desc' },
      distinct: ['workerId'],
      select: { workerId: true, body: true },
    });
    return new Map(rows.flatMap((row) => (row.workerId ? [[row.workerId, row.body] as [string, string]] : [])));
  }

  /**
   * Applies the alert rules to one crew assessment. Returns the state to pass
   * in next time, and how many alerts were stored.
   */
  async notifyCrew(
    n: CrewNotification,
    prev: CrewAlertState | null,
  ): Promise<{ state: CrewAlertState | null; sent: number; reason: AlertReason | null }> {
    const reason = decideAlert(prev, n.schedule.level, n.schedule.workMin, n.at);
    if (!reason) return { state: prev, sent: 0, reason: null };

    const now = new Date();
    const common = {
      assessmentId: n.assessmentId,
      reason,
      channel: 'APP' as const,
      status: 'SENT' as const,
      validAt: n.at,
      isReplay: n.isReplay,
      sentAt: now,
    };

    // A worker on their own schedule may see no change when the crew's changes.
    // Only a reminder repeats a message the worker already has.
    const lastBodies =
      prev?.workerBodies ?? (n.isReplay ? new Map<string, string>() : await this.lastWorkerBodies(n.workers.map((w) => w.id)));
    const workerBodies = new Map(lastBodies);
    const workerAlerts = [];
    for (const worker of n.workers) {
      const own = n.overrides.get(worker.id) ?? n.schedule;
      const body = workerMessage(worker.language, own.level, own.workMin, own.restMin);
      workerBodies.set(worker.id, body);
      if (reason !== 'REMINDER' && lastBodies.get(worker.id) === body) continue;
      workerAlerts.push({
        ...common,
        workerId: worker.id,
        audience: 'WORKER' as const,
        level: own.level,
        action: actionFor(own.level, own.workMin),
        body,
        language: messageLanguage(worker.language),
      });
    }

    const supervisorAlert = {
      ...common,
      crewId: n.crew.id,
      audience: 'SUPERVISOR' as const,
      level: n.schedule.level,
      action: actionFor(n.schedule.level, n.schedule.workMin),
      body: supervisorCrewMessage(
        n.crew.name,
        n.schedule.level,
        n.schedule.workMin,
        n.schedule.restMin,
        n.overrides.size,
        reason,
      ),
      language: 'en',
    };

    await this.prisma.alert.createMany({ data: [...workerAlerts, supervisorAlert] });
    return {
      state: { level: n.schedule.level, workMin: n.schedule.workMin, at: n.at, workerBodies },
      sent: workerAlerts.length + 1,
      reason,
    };
  }

  /**
   * Red-flag path: an emergency instruction to the worker and to the crew's
   * supervisor, at once. It ignores the reminder rules and is never suppressed.
   */
  async escalate(workerId: string, symptoms: string[]) {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId }, include: { crew: true } });
    if (!worker) throw new NotFoundException(`Worker ${workerId} not found`);

    const now = new Date();
    const common = {
      reason: 'RED_FLAG',
      level: 'RED' as const,
      action: 'ESCALATE',
      channel: 'APP' as const,
      status: 'SENT' as const,
      validAt: now,
      sentAt: now,
    };
    const [workerAlert, supervisorAlert] = await this.prisma.$transaction([
      this.prisma.alert.create({
        data: {
          ...common,
          workerId: worker.id,
          audience: 'WORKER',
          body: workerEmergencyMessage(worker.language),
          language: messageLanguage(worker.language),
        },
      }),
      this.prisma.alert.create({
        data: {
          ...common,
          workerId: worker.id,
          crewId: worker.crewId,
          audience: 'SUPERVISOR',
          body: supervisorEmergencyMessage(worker.pseudonym, worker.crew.name, symptoms),
          language: 'en',
        },
      }),
    ]);
    return { workerAlert, supervisorAlert };
  }

  /** A crew's active workers. No names are stored, only pseudonyms. */
  crewWorkers(crewId: string) {
    return this.prisma.worker.findMany({
      where: { crewId, active: true },
      orderBy: { pseudonym: 'asc' },
      select: { id: true, pseudonym: true, language: true, acclimatizedFrom: true },
    });
  }

  /** Workers with an emergency the supervisor has not acknowledged yet. */
  needsCheck(crewId: string) {
    return this.prisma.alert.findMany({
      where: { crewId, audience: 'SUPERVISOR', reason: 'RED_FLAG', ackAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, body: true, createdAt: true, worker: { select: { id: true, pseudonym: true } } },
    });
  }

  async acknowledge(alertId: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException(`Alert ${alertId} not found`);
    if (alert.ackAt) return alert;
    return this.prisma.alert.update({ where: { id: alertId }, data: { ackAt: new Date(), status: 'ACKNOWLEDGED' } });
  }

  /** Supervisor inbox for a crew. With replay = true, the alerts of the latest replayed day. */
  async crewAlerts(crewId: string, replay = false) {
    if (!replay) {
      return this.prisma.alert.findMany({
        where: { crewId, audience: 'SUPERVISOR', isReplay: false },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    }
    const latest = await this.prisma.riskAssessment.findFirst({
      where: { crewId, isReplay: true },
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    });
    if (!latest) return [];
    return this.prisma.alert.findMany({
      where: { crewId, audience: 'SUPERVISOR', isReplay: true, assessment: { computedAt: latest.computedAt } },
      orderBy: { validAt: 'asc' },
    });
  }

  /** Worker inbox. With replay = true, the alerts of the latest replayed day. */
  async workerAlerts(workerId: string, replay = false) {
    if (!replay) {
      return this.prisma.alert.findMany({
        where: { workerId, audience: 'WORKER', isReplay: false },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    }
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId }, select: { crewId: true } });
    if (!worker) throw new NotFoundException(`Worker ${workerId} not found`);
    const latest = await this.prisma.riskAssessment.findFirst({
      where: { crewId: worker.crewId, isReplay: true },
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    });
    if (!latest) return [];
    return this.prisma.alert.findMany({
      where: { workerId, audience: 'WORKER', isReplay: true, assessment: { computedAt: latest.computedAt } },
      orderBy: { validAt: 'asc' },
    });
  }
}
