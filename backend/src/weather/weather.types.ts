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
