import { Injectable, NotFoundException } from '@nestjs/common';
import type { Level } from '../ai/ai.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { symptomOptions, textDirection } from './symptom-labels.js';

export type ConsentScope = 'CHECKIN' | 'WEARABLE';
export const CONSENT_SCOPES: ConsentScope[] = ['CHECKIN', 'WEARABLE'];

export interface ScheduleView {
  level: Level;
  workMin: number;
  restMin: number;
  validAt: Date;
  /** True when this is the worker's own schedule rather than the crew's. */
  isOwn: boolean;
  reasons: string[];
}

@Injectable()
export class WorkersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything the worker's own page shows. */
  async today(workerId: string, replay: boolean) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      include: {
        crew: { include: { site: { select: { name: true, timezone: true } } } },
        consents: { where: { withdrawnAt: null }, select: { scope: true } },
      },
    });
    if (!worker) throw new NotFoundException('Worker not found');

    const assessment = await this.prisma.riskAssessment.findFirst({
      where: { crewId: worker.crewId, horizonMin: 0, isReplay: replay },
      orderBy: [{ computedAt: 'desc' }, { validAt: 'desc' }],
      include: { workerRisks: { where: { workerId }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    let schedule: ScheduleView | null = null;
    if (assessment) {
      const own = assessment.workerRisks[0];
      schedule =
        own && own.workMin !== null && own.restMin !== null
          ? {
              level: own.level,
              workMin: own.workMin,
              restMin: own.restMin,
              validAt: assessment.validAt,
              isOwn: true,
              reasons: own.reasons,
            }
          : {
              level: assessment.level,
              workMin: assessment.workMin,
              restMin: assessment.restMin,
              validAt: assessment.validAt,
              isOwn: false,
              reasons: [],
            };
    }

    // The latest thing the worker was actually told, replayed or live: their
    // phone shows the most recent message, not one filtered by which day the
    // supervisor happens to be reading.
    const message = await this.prisma.alert.findFirst({
      where: { workerId, audience: 'WORKER' },
      orderBy: { createdAt: 'desc' },
      select: { body: true, language: true, level: true, createdAt: true },
    });

    const granted = new Set(worker.consents.map((c) => c.scope));
    return {
      worker: {
        id: worker.id,
        pseudonym: worker.pseudonym,
        language: worker.language,
        direction: textDirection(worker.language),
        crewName: worker.crew.name,
        siteName: worker.crew.site.name,
        timezone: worker.crew.site.timezone,
      },
      schedule,
      message,
      consents: Object.fromEntries(CONSENT_SCOPES.map((scope) => [scope, granted.has(scope)])),
      symptomOptions: symptomOptions(worker.language),
    };
  }

  /**
   * Records a consent decision. Withdrawing closes every open consent for that
   * scope; granting opens a new one, so the history is kept either way.
   */
  async setConsent(workerId: string, scope: ConsentScope, granted: boolean) {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId }, select: { id: true } });
    if (!worker) throw new NotFoundException('Worker not found');

    const open = await this.prisma.consent.findMany({ where: { workerId, scope, withdrawnAt: null }, select: { id: true } });
    if (granted) {
      if (open.length === 0) await this.prisma.consent.create({ data: { workerId, scope } });
    } else if (open.length > 0) {
      await this.prisma.consent.updateMany({
        where: { id: { in: open.map((c) => c.id) } },
        data: { withdrawnAt: new Date() },
      });
    }
    const still = await this.prisma.consent.findMany({ where: { workerId, withdrawnAt: null }, select: { scope: true } });
    const names = new Set(still.map((c) => c.scope));
    return Object.fromEntries(CONSENT_SCOPES.map((s) => [s, names.has(s)]));
  }
}
