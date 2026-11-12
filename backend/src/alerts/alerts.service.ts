import { Injectable, NotFoundException } from '@nestjs/common';
import type { Level } from '../ai/ai.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  actionFor,
  decideAlert,
  decideWorkerAlert,
  type AlertReason,
  type CrewAlertState,
  type WorkerMessageState,
} from './alert-rules.js';
import {
  messageLanguage,
  supervisorCrewMessage,
  supervisorCheckMessage,
  supervisorEmergencyMessage,
  workerCheckinMessage,
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
      where: { crewId, audience: 'SUPERVISOR', isReplay: false, reason: { notIn: ['RED_FLAG', 'SYMPTOM'] } },
      orderBy: { createdAt: 'desc' },
      select: { level: true, validAt: true, assessment: { select: { workMin: true } } },
    });
    return last ? { level: last.level, workMin: last.assessment?.workMin ?? null, at: last.validAt } : null;
  }

  /** Each worker's most recent live heat message. */
  private async lastWorkerMessages(workerIds: string[]): Promise<Map<string, WorkerMessageState>> {
    const rows = await this.prisma.alert.findMany({
      where: { workerId: { in: workerIds }, audience: 'WORKER', isReplay: false, reason: { notIn: ['RED_FLAG', 'SYMPTOM'] } },
      orderBy: { createdAt: 'desc' },
      distinct: ['workerId'],
      select: { workerId: true, body: true, validAt: true },
    });
    const last = new Map<string, WorkerMessageState>();
    for (const row of rows) {
      if (row.workerId) last.set(row.workerId, { body: row.body, at: row.validAt });
    }
    return last;
  }

  /**
   * Applies the alert rules to one crew assessment. The supervisor is alerted
   * on the crew's level and schedule; each worker is judged on their own, so a
   * worker on a stricter schedule is reminded at their own level's interval.
   * Returns the state to pass in next time and how many alerts were stored.
   */
  async notifyCrew(
    n: CrewNotification,
    prev: CrewAlertState | null,
  ): Promise<{ state: CrewAlertState; sent: number; reason: AlertReason | null }> {
    const reason = decideAlert(prev, n.schedule.level, n.schedule.workMin, n.at);
    const last =
      prev?.workers ??
      (n.isReplay ? new Map<string, WorkerMessageState>() : await this.lastWorkerMessages(n.workers.map((w) => w.id)));
    const workers = new Map(last);

    const now = new Date();
    const common = {
      assessmentId: n.assessmentId,
      channel: 'APP' as const,
      status: 'SENT' as const,
      validAt: n.at,
      isReplay: n.isReplay,
      sentAt: now,
    };

    const alerts = [];
    for (const worker of n.workers) {
      const own = n.overrides.get(worker.id) ?? n.schedule;
      const body = workerMessage(worker.language, own.level, own.workMin, own.restMin);
      const workerReason = decideWorkerAlert(last.get(worker.id), own.level, body, reason, n.at);
      if (!workerReason) continue;
      workers.set(worker.id, { body, at: n.at });
      alerts.push({
        ...common,
        reason: workerReason,
        workerId: worker.id,
        crewId: null,
        audience: 'WORKER' as const,
        level: own.level,
        action: actionFor(own.level, own.workMin),
        body,
        language: messageLanguage(worker.language),
      });
    }

    if (reason) {
      alerts.push({
        ...common,
        reason,
        workerId: null,
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
      });
    }

    if (alerts.length > 0) await this.prisma.alert.createMany({ data: alerts });

    // The crew's clock restarts only when the supervisor was alerted.
    const state: CrewAlertState =
      reason || !prev
        ? { level: n.schedule.level, workMin: n.schedule.workMin, at: n.at, workers }
        : { ...prev, workers };
    return { state, sent: alerts.length, reason };
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

  /**
   * A worker reported symptoms that are not an emergency: tell them to rest and
   * ask the supervisor to check on them. `urgent` is for a possible red flag
   * that the language model and the keyword net disagreed on.
   */
  async requestCheck(workerId: string, urgent: boolean, schedule?: Schedule) {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId }, include: { crew: true } });
    if (!worker) throw new NotFoundException(`Worker ${workerId} not found`);
    const now = new Date();
    const common = {
      reason: 'SYMPTOM',
      level: schedule?.level ?? ('YELLOW' as const),
      action: 'REST',
      channel: 'APP' as const,
      status: 'SENT' as const,
      validAt: now,
      sentAt: now,
      workerId: worker.id,
    };
    await this.prisma.alert.createMany({
      data: [
        {
          ...common,
          audience: 'WORKER',
          body: workerCheckinMessage(worker.language),
          language: messageLanguage(worker.language),
        },
        {
          ...common,
          crewId: worker.crewId,
          audience: 'SUPERVISOR',
          body: supervisorCheckMessage(worker.pseudonym, worker.crew.name, urgent, schedule),
          language: 'en',
        },
      ],
    });
  }

  /** A crew's active workers. No names are stored, only pseudonyms. */
  crewWorkers(crewId: string) {
    return this.prisma.worker.findMany({
      where: { crewId, active: true },
      orderBy: { pseudonym: 'asc' },
      select: { id: true, pseudonym: true, language: true, acclimatizedFrom: true },
    });
  }

  /** Workers with an emergency or a reported symptom that the supervisor has not acknowledged yet. */
  needsCheck(crewId: string) {
    return this.prisma.alert.findMany({
      where: { crewId, audience: 'SUPERVISOR', reason: { in: ['RED_FLAG', 'SYMPTOM'] }, ackAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, reason: true, body: true, createdAt: true, worker: { select: { id: true, pseudonym: true } } },
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
