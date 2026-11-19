# Assumptions and limitations

What HeatGuard assumes, what it does not do, and what a pilot would need to change. Numbers and their caveats are in [metrics.md](metrics.md); formulas and sources in [risk-model.md](risk-model.md).

## Assumptions in the heat model

| Assumption | Why it matters |
| --- | --- |
| The NIOSH 2016 limits (REL for acclimatized workers, RAL for others) are the right exposure limits | They are the basis of every schedule. They were derived mostly from studies of young, fit men; individual tolerance varies widely. |
| WBGT can be estimated from forecast weather with the Liljegren model | No on-site WBGT is measured. Local effects (reflective surfaces, enclosed spaces, machinery heat) are missed. |
| Each crew does one task type at a fixed metabolic rate (180 to 520 W) for the whole shift | Real work mixes tasks. A crew doing heavier work than its task type says is under-protected. |
| Clothing adjustment is 0 °C for every task | Correct for ordinary work clothes. Coveralls or protective suits need a positive adjustment, which the data model supports but the demo does not set. |
| Breaks are taken in a cooled rest area at 22 °C WBGT (the seeded sites) | The rest area changes the schedule more than anything else. The setting must match the real rest area and be checked on site. |
| A worker is unacclimatized for the first 14 days on site | The date is set per worker. NIOSH's stepped daily build-up (20% more each day) and the loss of acclimatization after a week away are not implemented; a supervisor would have to reset the date after leave. |
| Breaks are actually taken | HeatGuard cannot tell. See adherence in [metrics.md](metrics.md). |

## Data limitations

- **No ground truth.** The "recorded weather" used for evaluation and replays is Open-Meteo's historical analysis, a model, not a weather station on site. The evaluation measures forecast against analysis.
- **Two sites, one region, one provider.** Mussafah and KIZAD, about 45 km apart, both coastal Abu Dhabi. Results may not hold inland, in other Gulf cities, or with another weather provider.
- **Summer only.** All data is May to September.
- **The live 6-hour outlook is not evaluated.** The archive has no same-day forecasts, so only the day-ahead plan could be tested.
- **Small intake test set.** 33 messages across three languages, written for the project, with the Arabic and Hindi ones unreviewed.

## Limitations of the AI components

- **The forecast correction has no untouched test left.** Its settings were chosen after seeing all three summers. It is used for planning only and is usually switched off.
- **The intake can miss a red flag described in words that are not in the keyword list.** The worker can always tap the symptom directly. The Arabic and Hindi keyword lists need native-speaker review.
- **Three languages.** English, Arabic and Hindi. Urdu, Bengali, Malayalam, Tagalog and Nepali, all common on Abu Dhabi sites, are not covered.
- **Speech input** works in the backend and AI service but the worker page has no record button yet.

## Scope cut for the deadline

| Planned | Status |
| --- | --- |
| WhatsApp and SMS delivery (Twilio) | Not built. Messages appear on the worker page and the dashboard only. A worker without a smartphone gets nothing directly. |
| Wearable heart-rate baseline | Design only. The consent scope and the `WearableSample` table exist. |
| Offline worker page | Not built. Sites with poor coverage need SMS. |
| Retention job | Policy written ([governance.md](governance.md)), not enforced. |
| Audit log viewer | Logged, no screen. |
| Planning screen | The planning estimate is an API endpoint only. |
| Job queue for the risk timer | The timer runs inside the backend, so only one backend instance can run. |

## Regulatory context not modelled

- **The UAE midday work ban** (outdoor work under direct sun prohibited 12:30 to 15:00, 15 June to 15 September) is not built in. Inside those dates the 06:00 to 14:00 demo shift overlaps it for the last 90 minutes; a real deployment should mark those hours as no outdoor work.
- **Employer obligations** under UAE labour and data protection law have not had legal review.

## Security limitations

- Worker links are bearer credentials (see [governance.md](governance.md)). A pilot needs one-time SMS codes.
- The demo accounts share one password, published to judges.
- There is no rate limiting on sign-in.

## What a pilot would add first

1. Native-speaker review of the Arabic and Hindi messages, keywords and test phrases; add Urdu and Bengali.
2. An on-site WBGT sensor at each site to check the weather-based estimate.
3. SMS or WhatsApp delivery, so workers without a smartphone are reached.
4. The midday ban in the schedule.
5. Adherence measurement: a "break started" tap, and the site's first-aid records for comparison.
