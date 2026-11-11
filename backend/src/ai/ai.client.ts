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

/** Client for the Python service. It owns the heat rules; this backend never computes a level itself. */
@Injectable()
export class AiClient {
  private readonly baseUrl = (process.env.AI_SERVICE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

  async assess(body: AssessRequest): Promise<AssessResponse> {
    const res = await fetch(`${this.baseUrl}/assess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`AI service /assess responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as AssessResponse;
  }
}
