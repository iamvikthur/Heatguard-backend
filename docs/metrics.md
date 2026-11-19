# HeatGuard metrics

Last updated 19 Nov 2026. Outcome metrics come from `ai/models/alerts_eval.json` (`python -m training.evaluate_alerts`). Forecast numbers come from `ai/models/forecast_v1.json`, written by `python -m training.train_forecast` on 12 Nov 2026.

## The six outcome metrics (requirement 6)

| Metric | Result | Source |
| --- | --- | --- |
| Alert lead time | Stop-work (RED) hours are flagged by the day-ahead plan a median of **16.5 to 18 hours** ahead. Of the summer days that reached RED for the concrete crew, **83 to 96%** were flagged the evening before. | Three recorded summers |
| False-alarm rate | For the concrete crew, **15 to 43%** of the RED hours flagged the evening before were not RED on the day (37 to 73% for the rebar crew, which reaches RED less often). For ORANGE or worse it is **2 to 14%**. On the day, the live 15-minute runs replace the plan. | Three recorded summers |
| Lost work time | With a cooled rest area, a concrete crew rests **3.7 hours** of an 8-hour summer shift; with breaks in shade, **6.1 hours**. The cooled rest area gives back **2 to 2.4 hours of work per shift**. | Three recorded summers |
| Symptom reports | Checked on the live deployment: a tapped symptom and a typed Hindi message were both read correctly and put the worker on the supervisor's "needs check" list. Accuracy across languages is not yet measured; the test set and script are ready (below). | Live tests; test set ready |
| Escalations | "I have a headache but have not vomited" (Hindi) led to an urgent in-person check, not a false emergency: the model read the negation, and the keyword net's disagreement was passed on rather than dropped. Red-flag recall is not yet measured. | Live test; test set ready |
| Adherence | Not measurable without crews. **Pilot metric**, defined below. | — |

### How the first three were measured

`python -m training.evaluate_alerts` (writes `ai/models/alerts_eval.json`) runs the work/rest rules on every shift hour, 06:00 to 14:00 Gulf time, May to September 2024, 2025 and 2026, at both sites: 306 shifts per workload per summer. Each hour is computed twice: from the 24-hour-ahead forecast, which is what the planning view shows the evening before, and from the recorded weather, which is what the day turned out to be. Crews are acclimatized with breaks in a 22 °C WBGT cooled rest area, as on the seeded sites. The plan is assumed to reach supervisors at 18:00 the evening before.

**ORANGE is the normal state of a summer shift.** With the NIOSH limits, 77 to 93% of shift hours are ORANGE or worse, depending on the workload. So the useful warning is RED (15 minutes of work an hour or less), and the useful daily output is the schedule itself.

RED warning, day ahead:

| Summer | Crew | Shifts with a RED hour | Flagged the evening before | RED hours flagged | Median lead | Flagged hours that were not RED |
| --- | --- | --- | --- | --- | --- | --- |
| 2024 | Concrete (520 W) | 138 of 306 | 95.7% | 90.9% | 16.5 h | 42.9% |
| 2025 | Concrete (520 W) | 143 of 306 | 83.2% | 73.5% | 17 h | 43.3% |
| 2026 | Concrete (520 W) | 159 of 306 | 91.8% | 85.2% | 17 h | 15.5% |
| 2024 | Rebar (415 W) | 37 of 306 | 86.5% | 73.0% | 17 h | 73.3% |
| 2025 | Rebar (415 W) | 40 of 306 | 57.5% | 42.3% | 18 h | 72.0% |
| 2026 | Rebar (415 W) | 58 of 306 | 79.3% | 66.7% | 17 h | 36.8% |

The formwork crew (300 W) almost never reaches RED with a cooled rest area (0 to 7 shifts a summer).

Day-ahead schedule against the day, all crews:

| Summer | Exactly right | Too lenient | Too strict |
| --- | --- | --- | --- |
| 2024 | 75 to 78% | 2.3 to 2.7% | 19 to 22% |
| 2025 | 72 to 75% | 3.4 to 4.9% | 21 to 23% |
| 2026 | 86 to 88% | 5.6 to 6.7% | 7 to 8% |

"Too lenient" means the plan allowed more work than the day's weather did; by a median of 15 minutes, one schedule step. In 2024 and 2025 the raw forecast ran hot, so the plan erred strict; in 2026 it was unbiased, so it was right more often and lenient a little more often (see the forecast sections below). On the day, the live 15-minute runs replace the plan, so a lenient plan is corrected before the hour starts, provided the live forecast is right.

Lost work time, rest per 8-hour shift on the recorded weather (mean of three summers, rounded):

| Crew | Cooled rest area | Shade | Open sun |
| --- | --- | --- | --- |
| Formwork (300 W) | 2.5 h | 4.5 h | 5.2 h |
| Rebar (415 W) | 3.2 h | 5.5 h | 5.9 h |
| Concrete (520 W) | 3.7 h | 6.1 h | 6.4 h |

This is the time the NIOSH limits require, not time lost to HeatGuard. Its use is the comparison: compared with shade, a cooled rest area gives back 2 to 2.4 hours of work per shift. Alert burden is low: a crew's schedule changes 1.5 to 1.8 times per shift.

**What these numbers cannot show.** The live 6-hour outlook is not evaluated, because the archive holds no same-day forecasts. "Recorded weather" is the provider's analysis, not an on-site sensor. Individual uplift (new arrivals, symptoms) is not included. The UAE midday work ban (12:30 to 15:00, 15 June to 15 September) is not modelled; it overlaps the last hour and a half of this shift.

### Symptom reports and escalations

These depend on what workers write, so they cannot be measured from weather data. What exists:

- **Live checks on the deployed system.** A tapped "very thirsty" put the worker on the needs-check list. A typed Hindi message, "I have a headache but have not vomited", was read as a headache only. The keyword net matched "vomited", and because the model disagreed, the worker was sent for an urgent in-person check rather than an emergency (the disputed-flag rule in [ai-and-guardrails.md](ai-and-guardrails.md)).
- **A test set and scoring script, not yet run.** `ai/tests/data/intake_cases.json` holds 33 messages (13 English, 10 Arabic, 10 Hindi), including red flags and negations. `python -m training.evaluate_intake` scores them against the configured model per language: exact matches, red-flag recall, false red flags, and urgent checks raised on messages with no red flag. It writes `ai/models/intake_eval.json`. The target is 100% red-flag recall. The Arabic and Hindi messages are machine-drafted and should be reviewed by native speakers before the scores are relied on.
- **Unit tests** (`ai/tests/test_intake.py`) cover the decision table with a stubbed model: model and keyword agreement, model failure, disputed flags and negations.

In a pilot, the counts to report are check-ins per 100 worker-shifts, the share raising a needs-check, emergencies, and for each emergency whether the supervisor acknowledged it and how fast.

### Adherence (pilot metric)

Adherence needs real crews, so it is defined here for a pilot rather than reported:

- **Alert acknowledgement:** share of supervisor alerts acknowledged ("I have checked"), and median time to acknowledge. Every alert and acknowledgement is already stored with timestamps.
- **Check-in uptake:** share of workers on ORANGE or RED shifts who send at least one check-in.
- **Schedule adherence:** share of scheduled rest breaks actually taken. HeatGuard does not record breaks today; a pilot would add a "break started" tap or a rest-area door counter.
- **Outcome:** heat-related first-aid cases per 1,000 worker-shifts, compared with the same sites' records from the previous summer.

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
