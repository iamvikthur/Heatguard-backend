import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AiClient, type AssessRequest, type Level, type WeatherInput } from '../ai/ai.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { loadForecastPairs, replaySlug } from '../replay/replay-data.js';
import { coversTimeOfDay } from '../risk/risk.service.js';
import { OpenMeteoClient } from '../weather/open-meteo.client.js';
import type { ForecastPair, HourlyWeather } from '../weather/weather.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 46;

export interface ScheduleView {
  level: Level;
  workMin: number;
  restMin: number;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Plans a coming day from its 24-hour-ahead forecast.
 *
 * Two schedules are returned for each crew hour: one from the raw forecast and
 * one from the adaptive planning estimate. This is for planning only: on the
 * day itself, work/rest decisions come from the live outlook, never from here.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly weather: OpenMeteoClient,
  ) {}

  async planDay(siteId: string, date: string | undefined, visibleCrewIds: Set<string>) {
    const day = date ?? isoDate(new Date(Date.now() + DAY_MS));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const dayStart = new Date(`${day}T00:00:00Z`);
    const from = isoDate(new Date(dayStart.getTime() - HISTORY_DAYS * DAY_MS));

    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: {
        crews: {
          where: { id: { in: [...visibleCrewIds] } },
          orderBy: { name: 'asc' },
          include: {
            shifts: {
              where: { endsAt: { gt: dayStart } },
              orderBy: { startsAt: 'asc' },
              take: 1,
              include: { taskType: true },
            },
          },
        },
      },
    });
    if (!site) throw new NotFoundException('Site not found');

    const { pairs, source } = await this.loadPairs(site.latitude, site.longitude, from, day);
    const target = pairs.filter((p) => p.forecast && isoDate(p.validAt) === day);
    if (target.length === 0) {
      throw new BadRequestException(`No 24-hour-ahead forecast is available for ${day}`);
    }
    const now = Date.now();
    const history = pairs.filter(
      (p) => p.forecast && p.observed && p.validAt.getTime() < dayStart.getTime() && p.validAt.getTime() < now,
    );

    const toInput = (w: HourlyWeather): WeatherInput => ({
      validAt: w.validAt.toISOString(),
      latitude: site.latitude,
      longitude: site.longitude,
      tempC: w.tempC,
      humidityPct: w.humidityPct,
      windMs: w.windMs,
      radiationWm2: w.radiationWm2,
      directRadiationWm2: w.directRadiationWm2 ?? undefined,
    });

    const plan = await this.ai.plan({
      history: history.map((p) => ({ forecast: toInput(p.forecast!), observed: toInput(p.observed!) })),
      target: target.map((p) => toInput(p.forecast!)),
    });
    const planByHour = new Map(plan.hours.map((h) => [Date.parse(h.validAt), h]));

    const restInShade = site.restArea !== 'SUN';
    const restWbgtC = site.restArea === 'COOLED' && site.restWbgtC !== null ? site.restWbgtC : undefined;

    const crews = [];
    for (const crew of site.crews) {
      const shift =
        crew.shifts[0] ??
        (await this.prisma.shift.findFirst({ where: { crewId: crew.id }, orderBy: { startsAt: 'desc' }, include: { taskType: true } }));
      if (!shift) {
        crews.push({ crewId: crew.id, name: crew.name, task: null, hours: [] });
        continue;
      }
      const hours = [];
      for (const pair of target) {
        if (!coversTimeOfDay(shift, pair.validAt)) continue;
        const estimate = planByHour.get(pair.validAt.getTime());
        if (!estimate) continue;
        const request: AssessRequest = {
          weather: toInput(pair.forecast!),
          metabolicWatts: shift.taskType.metabolicWatts,
          clothingAdjC: shift.taskType.clothingAdjC,
          acclimatized: true,
          restInShade,
          restWbgtC,
          fallback: false,
        };
        const raw = await this.ai.assess(request);
        const adjusted =
          plan.active && estimate.wbgtPlanC !== estimate.wbgtRawC
            ? await this.ai.assess({ ...request, wbgtC: estimate.wbgtPlanC })
            : raw;
        const view = (r: typeof raw): ScheduleView => ({ level: r.level, workMin: r.workMin, restMin: r.restMin });
        hours.push({
          validAt: pair.validAt,
          wbgtRawC: estimate.wbgtRawC,
          wbgtPlanC: estimate.wbgtPlanC,
          rawForecast: view(raw),
          planEstimate: view(adjusted),
        });
      }
      crews.push({ crewId: crew.id, name: crew.name, task: shift.taskType.name, hours });
    }

    return {
      siteId: site.id,
      date: day,
      weatherSource: source,
      model: {
        version: plan.modelVersion,
        active: plan.active,
        historyHoursUsed: plan.historyHoursUsed,
        windowBiasC: plan.windowBiasC,
      },
      note: plan.active
        ? 'Planning estimate only. The correction is switched on because the recent forecast has been biased. Decisions on the day come from the live outlook.'
        : 'Planning estimate only. The correction is switched off (too little history or no clear recent bias), so both schedules use the raw forecast.',
      crews,
    };
  }

  /** Downloaded data/raw files when they cover the planned day; otherwise the live Open-Meteo API. */
  private async loadPairs(latitude: number, longitude: number, from: string, to: string): Promise<{ pairs: ForecastPair[]; source: string }> {
    const slug = replaySlug(latitude, longitude);
    if (slug) {
      const pairs = await loadForecastPairs(slug, from, to);
      if (pairs.some((p) => p.forecast && isoDate(p.validAt) === to)) return { pairs, source: 'data/raw' };
    }
    try {
      return { pairs: await this.weather.fetchForecastPairs(latitude, longitude, from, to), source: 'open-meteo' };
    } catch (err) {
      throw new BadRequestException(`Could not load forecast history: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
