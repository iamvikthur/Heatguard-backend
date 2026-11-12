import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AiClient, type IntakeResponse } from '../ai/ai.client.js';
import { AlertsService, type Schedule } from '../alerts/alerts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Must match ai/app/intake/symptoms.py. */
export const SYMPTOMS = [
  'dizziness',
  'headache',
  'nausea',
  'cramps',
  'heavy_sweating',
  'stopped_sweating',
  'confusion',
  'fainting',
  'vomiting',
  'very_thirsty',
  'weakness',
];
export const RED_FLAGS = ['confusion', 'fainting', 'stopped_sweating', 'vomiting'];

const HOUR_MS = 60 * 60 * 1000;
const ACCLIMATIZATION_DAYS = 14;
/** How long a reported symptom keeps a worker on the stricter schedule. */
export const SYMPTOM_HOLD_MIN = 120;

export interface CheckInInput {
  text?: string;
  audioBase64?: string;
  audioFilename?: string;
  /** Symptoms picked by tapping, for when the worker cannot or will not type or speak. */
  taps?: string[];
  /** Demo only: attach the stricter schedule to the latest replayed hour instead of the live one. */
  replay?: boolean;
}

export type CheckInAction = 'ESCALATED' | 'URGENT_CHECK' | 'STRICTER_SCHEDULE' | 'CHECK_REQUESTED' | 'NONE';

/** Builds the same result shape from tapped symptoms as the language model path returns. */
export function intakeFromTaps(taps: string[]): IntakeResponse {
  const unknown = taps.filter((name) => !SYMPTOMS.includes(name));
  if (unknown.length > 0) throw new BadRequestException(`Unknown symptom: ${unknown.join(', ')}`);
  const reported = SYMPTOMS.filter((name) => taps.includes(name));
  const redFlags = RED_FLAGS.filter((name) => reported.includes(name));
  return {
    transcript: '',
    fromAudio: false,
    symptoms: Object.fromEntries(SYMPTOMS.map((name) => [name, reported.includes(name)])),
    reported,
    redFlags,
    redFlag: redFlags.length > 0,
    keywordFlags: [],
    disputedFlags: [],
    needsUrgentCheck: false,
    extractor: 'KEYWORD',
    modelError: null,
    needsTapCheckin: false,
  };
}

@Injectable()
export class CheckinsService {
  private readonly logger = new Logger(CheckinsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly alerts: AlertsService,
  ) {}

  async submit(workerId: string, input: CheckInInput) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      include: { crew: { include: { site: true } }, consents: { where: { scope: 'CHECKIN', withdrawnAt: null } } },
    });
    if (!worker) throw new NotFoundException('Worker not found');
    if (worker.consents.length === 0) {
      throw new ForbiddenException('This worker has not consented to symptom check-ins');
    }

    const tapped = Array.isArray(input.taps);
    let result: IntakeResponse;
    if (tapped) {
      result = intakeFromTaps(input.taps!.filter((t): t is string => typeof t === 'string'));
    } else {
      try {
        result = await this.ai.intake({ text: input.text, audioBase64: input.audioBase64, audioFilename: input.audioFilename });
      } catch (err) {
        // The message could not be read at all. Never guess: ask for a tap check-in.
        this.logger.warn(`Intake failed for a check-in: ${String(err)}`);
        throw new BadRequestException('The message could not be read. Ask the worker to tap their symptoms instead.');
      }
    }

    const checkIn = await this.prisma.checkIn.create({
      data: {
        workerId: worker.id,
        channel: 'APP',
        language: worker.language,
        transcript: result.transcript || null,
        symptoms: result.symptoms,
        redFlag: result.redFlag,
        symptomCount: result.reported.length,
        extractor: tapped ? 'TAP' : result.extractor,
      },
    });

    let action: CheckInAction = 'NONE';
    let schedule: Schedule | undefined;
    if (result.redFlag) {
      await this.alerts.escalate(worker.id, result.redFlags);
      action = 'ESCALATED';
    } else if (result.needsUrgentCheck) {
      await this.alerts.requestCheck(worker.id, true);
      action = 'URGENT_CHECK';
    } else if (result.reported.length > 0) {
      schedule = await this.stricterSchedule(worker, input.replay === true);
      await this.alerts.requestCheck(worker.id, false, schedule);
      action = schedule ? 'STRICTER_SCHEDULE' : 'CHECK_REQUESTED';
    }

    return {
      checkInId: checkIn.id,
      action,
      reported: result.reported,
      redFlags: result.redFlags,
      disputedFlags: result.disputedFlags,
      extractor: checkIn.extractor,
      modelError: result.modelError,
      needsTapCheckin: result.needsTapCheckin,
      schedule: schedule ?? null,
    };
  }

  /**
   * Puts a worker one 15-minute step below what the rules would otherwise allow
   * them, for the crew's current hour. Returns undefined when the crew has no
   * recent assessment to attach it to (for example, outside shift hours).
   */
  private async stricterSchedule(
    worker: { id: string; crewId: string; acclimatizedFrom: Date; crew: { site: { id: string; latitude: number; longitude: number; restArea: string; restWbgtC: number | null } } },
    replay: boolean,
  ): Promise<Schedule | undefined> {
    const assessment = await this.prisma.riskAssessment.findFirst({
      where: {
        crewId: worker.crewId,
        horizonMin: 0,
        isReplay: replay,
        ...(replay ? {} : { validAt: { gte: new Date(Date.now() - 2 * HOUR_MS) } }),
      },
      orderBy: replay ? [{ computedAt: 'desc' }, { validAt: 'desc' }] : { computedAt: 'desc' },
      include: { crew: { include: { shifts: { orderBy: { startsAt: 'desc' }, take: 1, include: { taskType: true } } } } },
    });
    const task = assessment?.crew.shifts[0]?.taskType;
    if (!assessment || !task) return undefined;

    const site = worker.crew.site;
    const weather = await this.prisma.weatherSnapshot.findFirst({
      where: { siteId: site.id, validAt: assessment.validAt },
      orderBy: { issuedAt: 'desc' },
    });
    if (!weather) return undefined;

    try {
      const result = await this.ai.assess({
        weather: {
          validAt: weather.validAt.toISOString(),
          latitude: site.latitude,
          longitude: site.longitude,
          tempC: weather.tempC,
          humidityPct: weather.humidityPct,
          windMs: weather.windMs,
          radiationWm2: weather.radiationWm2,
          directRadiationWm2: weather.directRadiationWm2 ?? undefined,
          pressureHpa: weather.pressureHpa ?? undefined,
        },
        metabolicWatts: task.metabolicWatts,
        clothingAdjC: task.clothingAdjC,
        acclimatized: worker.acclimatizedFrom <= new Date(Date.now() - ACCLIMATIZATION_DAYS * 24 * HOUR_MS),
        restInShade: site.restArea !== 'SUN',
        restWbgtC: site.restArea === 'COOLED' && site.restWbgtC !== null ? site.restWbgtC : undefined,
        fallback: assessment.fallback,
        stricterSteps: 1,
      });
      const schedule: Schedule = { level: result.level, workMin: result.workMin, restMin: result.restMin };
      await this.prisma.workerRisk.create({
        data: { workerId: worker.id, assessmentId: assessment.id, ...schedule, reasons: ['SYMPTOMS'] },
      });
      return schedule;
    } catch (err) {
      this.logger.warn(`Could not compute a stricter schedule after a check-in: ${String(err)}`);
      return undefined;
    }
  }
}
