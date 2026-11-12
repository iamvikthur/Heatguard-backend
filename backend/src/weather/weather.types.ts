export interface HourlyWeather {
  /** End of the hour the values describe (UTC). */
  validAt: Date;
  tempC: number;
  humidityPct: number;
  windMs: number;
  radiationWm2: number;
  directRadiationWm2: number | null;
  pressureHpa: number | null;
}

/** One hour with the forecast made 24 hours ahead and, once it has passed, what was observed. */
export interface ForecastPair {
  validAt: Date;
  forecast: HourlyWeather | null;
  observed: HourlyWeather | null;
}
