import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AiClient, type AssessRequest } from '../ai/ai.client.js';
import { LEVEL_RANK, type CrewAlertState } from '../alerts/alert-rules.js';
import { AlertsService, type Schedule } from '../alerts/alerts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { loadObservedDay, replaySlug } from '../replay/replay-data.js';
import { OpenMeteoClient } from '../weather/open-meteo.client.js';
import type { HourlyWeather } from '../weather/weather.types.js';

const HOUR_MS = 60 * 60 * 1000;
const OUTLOOK_HOURS = 6;
const ACCLIMATIZATION_DAYS = 14;

export interface RunSummary {
  siteId: string;
  computedAt: string;
  assessments: number;
  workerRisks: number;
  alerts: number;
  fallback: boolean;
  isReplay: boolean;
  skipped: string[];
}

interface RunOptions {
  /** Hours to assess, in order. */
  hours: Date[];
  weather: HourlyWeather[];
  fallback: boolean;
  /** Replay: every hour is treated as the current hour and shifts are matched by time of day. */
  isReplay: boolean;
}

@Injectable()
export class RiskService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RiskService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly weather: OpenMeteoClient,
    private readonly ai: AiClient,
    private readonly alerts: AlertsService,
  ) {}

  /** Runs every RISK_INTERVAL_MIN minutes (default 15). Set it to 0 to disable the timer. */
  onModuleInit() {
    const minutes = Number(process.env.RISK_INTERVAL_MIN ?? 15);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.timer = setInterval(() => void this.runAll(), minutes * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll(): Promise<RunSummary[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const sites = await this.prisma.site.findMany({ select: { id: true } });
      const summaries: RunSummary[] = [];
      for (const site of sites) {
        try {
          summaries.push(await this.runForSite(site.id));
        } catch (err) {
          this.logger.error(`Risk run failed for site ${site.id}: ${String(err)}`);
        }
      }
      return summaries;
    } finally {
      this.running = false;
    }
  }

  /** Assesses every crew on shift at a site for the current hour and the next six. */
  async runForSite(siteId: string, at: Date = new Date()): Promise<RunSummary> {
    const start = new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
    const hours = Array.from({ length: OUTLOOK_HOURS + 1 }, (_, i) => new Date(start.getTime() + i * HOUR_MS));
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException(`Site ${siteId} not found`);
    const { rows, fallback } = await this.loadWeather(site.id, site.latitude, site.longitude, start, hours);
    return this.assessSite(siteId, { hours, weather: rows, fallback, isReplay: false });
  }

  /**
   * Replays one past UTC date from data/raw using the weather that was observed.
   * Crews are assessed for every hour that falls inside their usual shift times.
   */
  async replayDay(siteId: string, date: string): Promise<RunSummary> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException(`Site ${siteId} not found`);
    const slug = replaySlug(site.latitude, site.longitude);
    if (!slug) throw new BadRequestException('No replay data is available for this site');

    let weather: HourlyWeather[];
    try {
      weather = await loadObservedDay(slug, date);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    if (weather.length === 0) throw new BadRequestException(`No observed weather for ${date}`);

    await this.prisma.weatherSnapshot.createMany({
      data: weather.map((row) => ({ siteId, source: 'OBSERVED' as const, issuedAt: row.validAt, ...row })),
      skipDuplicates: true,
    });
    const hours = weather.map((row) => row.validAt);
    return this.assessSite(siteId, { hours, weather, fallback: false, isReplay: true });
  }

  private async assessSite(siteId: string, options: RunOptions): Promise<RunSummary> {
    const { hours, fallback, isReplay } = options;
    const first = hours[0];
    const last = new Date(hours[hours.length - 1].getTime() + HOUR_MS);

    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: {
        crews: {
          include: {
            workers: { where: { active: true } },
            shifts: {
              // Replay dates have no shifts of their own: take the crew's latest ones as the pattern.
              where: isReplay ? undefined : { startsAt: { lt: last }, endsAt: { gt: first } },
              orderBy: { startsAt: 'desc' },
              take: isReplay ? 1 : undefined,
              include: { taskType: true },
            },
          },
        },
      },
    });
    if (!site) throw new NotFoundException(`Site ${siteId} not found`);

    const skipped: string[] = [];
    const byHour = new Map(options.weather.map((row) => [row.validAt.getTime(), row]));
    // Acclimatization is about the worker today, also when replaying a past date.
    const cutoff = new Date(Date.now() - ACCLIMATIZATION_DAYS * 24 * HOUR_MS);

    const restInShade = site.restArea !== 'SUN';
    const restWbgtC = site.restArea === 'COOLED' && site.restWbgtC !== null ? site.restWbgtC : undefined;
    if (site.restArea === 'COOLED' && restWbgtC === undefined) {
      skipped.push('site has a cooled rest area but no measured restWbgtC; treated as shade');
    }

    const computedAt = new Date();
    let assessments = 0;
    let workerRisks = 0;
    let alerts = 0;
    const alertState = new Map<string, CrewAlertState | null>();

    for (const crew of site.crews) {
      for (const [index, hour] of hours.entries()) {
        const shift = crew.shifts.find((s) => (isReplay ? coversTimeOfDay(s, hour) : s.startsAt <= hour && hour < s.endsAt));
        if (!shift) continue;
        const weather = byHour.get(hour.getTime());
        if (!weather) {
          skipped.push(`${crew.name} ${hour.toISOString()}: no weather`);
          continue;
        }

        const request: AssessRequest = {
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
          metabolicWatts: shift.taskType.metabolicWatts,
          clothingAdjC: shift.taskType.clothingAdjC,
          acclimatized: true,
          restInShade,
          restWbgtC,
          fallback,
        };

        let result;
        try {
          result = await this.ai.assess(request);
        } catch (err) {
          // No rules service, no level: never guess one here.
          skipped.push(`${crew.name} ${hour.toISOString()}: ${String(err)}`);
          continue;
        }

        const assessment = await this.prisma.riskAssessment.create({
          data: {
            siteId: site.id,
            crewId: crew.id,
            computedAt,
            validAt: hour,
            horizonMin: isReplay ? 0 : index * 60,
            wbgtRaw: result.wbgtC,
            wbgtEffective: result.wbgtEffectiveC,
            limitC: result.limitC,
            level: result.level,
            workMin: result.workMin,
            restMin: result.restMin,
            restWbgtC: result.restWbgtC,
            workMinRestInSun: result.workMinRestInSun,
            fallback,
            isReplay,
          },
        });
        assessments += 1;

        // The rest applies to the current hour only (every hour, in a replay).
        if (index !== 0 && !isReplay) continue;

        // Workers still acclimatizing get their own schedule when it is stricter.
        const overrides = new Map<string, Schedule>();
        const newArrivals = crew.workers.filter((w) => w.acclimatizedFrom > cutoff);
        if (newArrivals.length > 0) {
          try {
            const strict = await this.ai.assess({ ...request, acclimatized: false });
            if (LEVEL_RANK[strict.level] > LEVEL_RANK[result.level] || strict.workMin < result.workMin) {
              const own = { level: strict.level, workMin: strict.workMin, restMin: strict.restMin };
              await this.prisma.workerRisk.createMany({
                data: newArrivals.map((w) => ({
                  workerId: w.id,
                  assessmentId: assessment.id,
                  ...own,
                  reasons: ['UNACCLIMATIZED'],
                })),
              });
              workerRisks += newArrivals.length;
              for (const w of newArrivals) overrides.set(w.id, own);
            }
          } catch (err) {
            skipped.push(`${crew.name} unacclimatized check: ${String(err)}`);
          }
        }

        try {
          if (!alertState.has(crew.id)) {
            alertState.set(crew.id, isReplay ? null : await this.alerts.lastCrewState(crew.id));
          }
          const outcome = await this.alerts.notifyCrew(
            {
              assessmentId: assessment.id,
              crew: { id: crew.id, name: crew.name },
              workers: crew.workers.map((w) => ({ id: w.id, language: w.language })),
              schedule: { level: result.level, workMin: result.workMin, restMin: result.restMin },
              overrides,
              at: isReplay ? hour : new Date(),
              isReplay,
            },
            alertState.get(crew.id) ?? null,
          );
          alertState.set(crew.id, outcome.state);
          alerts += outcome.sent;
        } catch (err) {
          skipped.push(`${crew.name} ${hour.toISOString()} alerts: ${String(err)}`);
        }
      }
    }

    return { siteId: site.id, computedAt: computedAt.toISOString(), assessments, workerRisks, alerts, fallback, isReplay, skipped };
  }

  /** Sites of an organisation. With supervisorId, only the crews that user supervises are listed. */
  listSites(orgId: string, supervisorId?: string) {
    return this.prisma.site.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        timezone: true,
        restArea: true,
        restWbgtC: true,
        crews: { where: supervisorId ? { supervisorId } : undefined, select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Latest stored outlook for a site, grouped by crew. With replay = true, the latest replayed day instead. */
  async outlook(siteId: string, replay = false) {
    const latest = await this.prisma.riskAssessment.findFirst({
      where: { siteId, isReplay: replay },
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    });
    if (!latest) return { siteId, computedAt: null, isReplay: replay, crews: [] };

    const rows = await this.prisma.riskAssessment.findMany({
      where: { siteId, computedAt: latest.computedAt, isReplay: replay },
      orderBy: [{ crewId: 'asc' }, { validAt: 'asc' }],
      include: { crew: { select: { name: true } }, _count: { select: { workerRisks: true } } },
    });

    type CrewOutlook = { crewId: string; name: string; hours: unknown[] };
    const crews = new Map<string, CrewOutlook>();
    for (const row of rows) {
      const entry: CrewOutlook = crews.get(row.crewId) ?? { crewId: row.crewId, name: row.crew.name, hours: [] };
      entry.hours.push({
        validAt: row.validAt,
        horizonMin: row.horizonMin,
        level: row.level,
        workMin: row.workMin,
        restMin: row.restMin,
        workMinRestInSun: row.workMinRestInSun,
        wbgtC: row.wbgtRaw,
        limitC: row.limitC,
        restWbgtC: row.restWbgtC,
        fallback: row.fallback,
        workersAtHigherLevel: row._count.workerRisks,
      });
      crews.set(row.crewId, entry);
    }
    return { siteId, computedAt: latest.computedAt, isReplay: replay, crews: [...crews.values()] };
  }

  /** Fresh forecast if reachable; otherwise the newest stored forecast, flagged as fallback. */
  private async loadWeather(siteId: string, latitude: number, longitude: number, start: Date, hours: Date[]) {
    const wanted = new Set(hours.map((h) => h.getTime()));
    try {
      const forecast = await this.weather.fetchForecast(latitude, longitude);
      const rows = forecast.filter((row) => wanted.has(row.validAt.getTime()));
      if (rows.length === 0) throw new Error('forecast does not cover the requested hours');
      await this.prisma.weatherSnapshot.createMany({
        data: rows.map((row) => ({ siteId, source: 'FORECAST' as const, issuedAt: start, ...row })),
        skipDuplicates: true,
      });
      return { rows, fallback: false };
    } catch (err) {
      this.logger.warn(`Weather fetch failed for site ${siteId}, using stored forecast: ${String(err)}`);
      const stored = await this.prisma.weatherSnapshot.findMany({
        where: { siteId, source: 'FORECAST', validAt: { in: hours } },
        orderBy: { issuedAt: 'desc' },
      });
      const newest = new Map<number, HourlyWeather>();
      for (const row of stored) {
        if (!newest.has(row.validAt.getTime())) newest.set(row.validAt.getTime(), row);
      }
      return { rows: [...newest.values()], fallback: true };
    }
  }
}

/** True when the hour's UTC time of day falls inside the shift's UTC time-of-day window. */
export function coversTimeOfDay(shift: { startsAt: Date; endsAt: Date }, hour: Date): boolean {
  const minutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
  const start = minutes(shift.startsAt);
  const length = Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / 60000);
  const offset = (minutes(hour) - start + 1440) % 1440;
  return offset < length;
}
