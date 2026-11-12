# HeatGuard metrics

Last updated 12 Nov 2026. Numbers come from `ai/models/forecast_v1.json`, written by `python -m training.train_forecast` on 12 Nov 2026 (scikit-learn build on the project machine).

## Forecast-correction model

**What it does.** Takes tomorrow's forecast for a site (24 hours ahead) and corrects its WBGT using what the same forecast got wrong on past days. It returns two values: a best estimate, and a cautious plan value for scheduling.

**Data.** Open-Meteo, two Abu Dhabi sites, May to September. 7,344 hours per summer, 2024 to 2026. The "observed" WBGT is computed from Open-Meteo's historical record, which is a weather model's analysis, not a ground station.

**Model.** Histogram gradient boosting (scikit-learn), predicting the forecast's WBGT error from the forecast itself, hour, day of year, site, and yesterday's outcome at the same hour.

**Result: the model failed its held-out test and is not used for any decision.** It improved on the 2025 forecast and made the 2026 forecast worse.

A "miss" is an hour where the value was more than 1 C below what was observed. Shift hours are 06:00 to 14:00 Gulf time (2,448 per summer).

### Validation on summer 2025 (trained on 2024)

| | All hours: mean error | All hours: misses | Shift hours: mean error | Shift hours: misses |
| --- | --- | --- | --- | --- |
| Raw forecast | 1.22 C | 5.1% | 1.30 C | 9.1% |
| Best estimate | 0.96 C | 14.2% | 1.12 C | 24.4% |
| Plan value | 1.18 C | 4.7% | 1.25 C | 8.9% |

The plan quantile (0.85) was chosen on this data.

### Test on summer 2026 (trained on 2024 and 2025; 2026 used for nothing else)

| | All hours: mean error | All hours: misses | Shift hours: mean error | Shift hours: misses |
| --- | --- | --- | --- | --- |
| Raw forecast | 0.57 C | 6.1% | 0.65 C | 9.4% |
| Best estimate | 0.81 C | 27.4% | 0.90 C | 31.8% |
| Plan value | 0.67 C | 5.6% | 0.79 C | 6.9% |

### What this means

- In 2024 and 2025 the raw forecast ran about 0.9 C hot, and the model learned to remove that. In 2026 the raw forecast was nearly unbiased (+0.06 C) and less than half as wrong. The likely cause is a change in the upstream weather model, which we cannot see or control.
- So in 2026 the model corrected a bias that was no longer there. The best estimate was 42% less accurate than the raw forecast and missed dangerous heat more than four times as often.
- The plan value missed slightly less often than the raw forecast in 2026, but only by sitting higher (+0.26 C on average) at the cost of 18% more error. A fixed safety margin would do the same without a model.
- Lesson: a correction learned from past summers is not stable when the forecast source changes. Any future version must adapt to recent weeks and must be compared with the raw forecast continuously, switching itself off when it stops helping.
- Without the untouched 2026 test year, the 2025 numbers alone would have looked like a 21% accuracy gain.

## Adaptive version

Because the fixed model failed, a second version was built that (1) learns only from the last 45 days, refitted weekly, (2) aims high on purpose (0.8 quantile), and (3) switches itself off when the last 45 days show less than 0.4 C of average forecast error, in which case the raw forecast is used unchanged. Code: `ai/app/forecast/adaptive.py`. Evaluation: `python -m training.evaluate_adaptive`, a walk-forward test in which each week is predicted using only earlier data.

Shift hours (06:00 to 14:00 Gulf time):

| Summer | Weeks switched on | Raw: mean error | Raw: misses | Adaptive: mean error | Adaptive: misses |
| --- | --- | --- | --- | --- | --- |
| 2024 | 19 of 22 | 1.23 C | 4.9% | 1.12 C | 6.2% |
| 2025 | 19 of 22 | 1.30 C | 9.1% | 1.10 C | 8.9% |
| 2026 | 0 of 22 | 0.65 C | 9.4% | 0.65 C | 9.4% |

- When the forecast was biased (2024, 2025), the adaptive value was 9% and 15% more accurate in shift hours. Misses rose by 1.3 points in 2024 and were level in 2025.
- When the forecast was not biased (2026), it stayed switched off all summer and matched the raw forecast exactly. It did no harm.
- The first three weeks of each summer are always off, because there is not yet 45 days of history in the May to September data.
- Without the off switch, the same model was 14% less accurate than the raw forecast in 2026 shift hours, and a fixed +0.3 C margin on the raw forecast did better. The off switch is what makes this version safe to run.

**How far to trust it.** The window, quantile and off-switch threshold were settled after looking at all three summers, so no untouched test remains. The result rests on three summers at two nearby sites from one forecast provider. It is evidence that the approach is sound, not proof of a gain. An independent check needs other sites or summer 2027.

### Status

HeatGuard uses the raw forecast for the live outlook and for every work/rest decision on the day. The fixed model (`/forecast`) is not called by the backend. The adaptive version feeds one thing: the planning view (`GET /sites/:id/plan`), which shows the schedule from the raw forecast beside the schedule from the adaptive estimate. In serving it is fitted per site on each request; a per-site, daily-refit walk-forward check gave shift-hour errors of 1.09, 1.15 and 0.65 C for 2024, 2025 and 2026, in line with the table above.

### Limits

- Two sites, two summers. Results may not carry to other sites or to winter.
- No ground-station truth. A pilot needs an on-site WBGT sensor to validate against.
- Trained on 24-hour-ahead forecasts only. It is not valid for same-day forecasts, which is why the live 6-hour outlook uses the raw forecast.
- In serving, the plan value is never allowed below the raw forecast.
- The "observed" values and the forecasts come from the same provider, so a provider-side change affects both.
