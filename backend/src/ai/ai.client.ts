import { Injectable } from '@nestjs/common';

export type Level = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

export interface AssessRequest {
  weather: {
    validAt: string;
    latitude: number;
    longitude: number;
    tempC: number;
    humidityPct: number;
    windMs: number;
    radiationWm2: number;
    directRadiationWm2?: number;
    pressureHpa?: number;
  };
  metabolicWatts: number;
  clothingAdjC: number;
  acclimatized: boolean;
  restInShade: boolean;
  restWbgtC?: number;
  /** Use this WBGT instead of estimating it from the weather (planning values). */
  wbgtC?: number;
  fallback: boolean;
}

export interface AssessResponse {
  wbgtC: number;
  wbgtEffectiveC: number;
  limitC: number;
  marginC: number;
  level: Level;
  workMin: number;
  restMin: number;
  restWbgtC: number;
  workMinRestInSun: number;
  action: string;
}

export type WeatherInput = AssessRequest['weather'];

export interface PlanRequest {
  history: { forecast: WeatherInput; observed: WeatherInput }[];
  target: WeatherInput[];
}

export interface PlanResponse {
  modelVersion: string;
  active: boolean;
  historyHoursUsed: number;
  windowBiasC: number | null;
  hours: { validAt: string; wbgtRawC: number; wbgtPlanC: number }[];
}

/** Client for the Python service. It owns the heat rules; this backend never computes a level itself. */
@Injectable()
export class AiClient {
  private readonly baseUrl = (process.env.AI_SERVICE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

  assess(body: AssessRequest): Promise<AssessResponse> {
    return this.post<AssessResponse>('/assess', body, 10_000);
  }

  /** Planning estimate for a coming day. Fits a small model on the history, so it can take a few seconds. */
  plan(body: PlanRequest): Promise<PlanResponse> {
    return this.post<PlanResponse>('/plan', body, 60_000);
  }

  private async post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`AI service ${path} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
