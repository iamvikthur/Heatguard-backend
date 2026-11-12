# HeatGuard: implementation plan

Written 11 Nov 2026 against the current state of this folder. The challenge deadline is 20 Nov; the target submission date is 15 Nov (Challenge 07, Climate-Resilient Worker Health). Section 8 has the revised schedule and scope.

## 1. Where the repo stands

- `backend/` is a fresh NestJS 12 scaffold (ESM, Vitest, oxlint, bun lockfile). Only the default `AppController` exists.
- `backend/prisma/schema.prisma` has no models. No migrations.
- `backend/docker-compose.yml` runs Postgres 17 and Adminer. No Redis.
- Nothing is committed in `backend/.git`.
- There is no Python service and no frontend yet.

Phase 0 and the schema (sections 2 and 4) are done, and `ai/` and `data/` now exist. Section 8 has the schedule for the remaining work.

## 2. Fix these first (Phase 0, about 1 hour)

1. **Prisma is installed in the wrong place and at two versions.** The folder root has `package.json` + `node_modules` with `@prisma/client` 7.10.1, `@prisma/adapter-pg` and `pg`. `backend/package.json` has `prisma ^8.0.0-rc.33` as a runtime dependency and no client or adapter. Delete the root `package.json`, `package-lock.json` and `node_modules`. In `backend/`, install one matching stable set: `prisma` (dev), `@prisma/client`, `@prisma/adapter-pg`, `pg`. Avoid the 8.0 release candidate for a deadline build.
2. **Two Prisma configs.** Keep `prisma.config.ts` (use the `defineConfig` form from `prisma7.config.ts`), delete `prisma7.config.ts`.
3. **One package manager.** `bun.lock` is in `backend/`, `package-lock.json` at the root. Use bun throughout.
4. **Move `docker-compose.yml` to the folder root** and add Redis (and later the `ai` service). Rename the database from `nest_database` to `heatguard`.
5. **Make the first commit.** Confirm `.env` is ignored before committing. Consider one git repo at the folder root instead of inside `backend/`, since `ai/` and `web/` will sit beside it.
6. Read `backend/AGENTS.md` before adding packages: it lists the first-party Nest 12 packages (`@nestjs/bullmq`, `@nestjs/schedule`, `@nestjs/config`, `@nestjs/i18n`, `@nestjs/ai`) and the ESM rules (`.js` import suffixes, `vi.fn()`).

## 3. Target layout

```
HeatGuard/
  docker-compose.yml        postgres, redis, ai
  backend/                  NestJS 12: API, jobs, alerts, governance
  ai/                       Python FastAPI: WBGT + rules, forecast model, symptom intake
  web/                      Next.js: supervisor dashboard (built) + worker page (not built)
  data/                     weather pulls, intake test set, simulation output (gitignored where large)
  docs/                     architecture, risk model, governance, limitations, metrics
```

Rule of the architecture: **AI interprets and predicts; the deterministic rules decide.** Nest never takes a severity level from an LLM.

## 4. Data model (Prisma)

| Model | Key fields | Notes |
| --- | --- | --- |
| Organization | name | tenant boundary |
| Site | orgId, name, lat, lon, timezone | Abu Dhabi demo sites, e.g. Mussafah |
| Crew | siteId, name, supervisorId | |
| Worker | crewId, pseudonym, language, phone, acclimatizedFrom | no real names in demo data |
| User | orgId, email, passwordHash, role (SUPERVISOR, HSE, ADMIN) | |
| TaskType | name, metabolicWatts, clothingAdjC | light / moderate / heavy / very heavy |
| Shift | crewId, taskTypeId, startsAt, endsAt | what the crew is doing and when |
| Consent | workerId, scope (CHECKIN, WEARABLE), grantedAt, withdrawnAt | checked before any personal signal is used |
| WeatherSnapshot | siteId, validAt, issuedAt, tempC, rh, windMs, radiationWm2, source | raw forecast and observed |
| RiskAssessment | siteId, crewId, validAt, horizonMin, wbgtRaw, wbgtCorrected, limitC, level, workMin, restMin, fallback | one row per crew per time step, now and +6 h |
| WorkerRisk | workerId, assessmentId, level, reasons[] | individual uplift only |
| CheckIn | workerId, channel, language, transcript, symptoms (json), redFlag, extractor (LLM, KEYWORD, TAP), createdAt | transcript deleted by retention job |
| Alert | workerId or crewId, level, action, channel, language, status, sentAt, ackAt | |
| WearableSample | workerId, at, heartRate | simulated |
| AuditLog | actorId, action, entity, entityId, at | every read of individual data |

Levels are an enum: GREEN, YELLOW, ORANGE, RED.

## 5. Service contracts

### ai/ (FastAPI)

| Endpoint | Input | Output |
| --- | --- | --- |
| `POST /assess` | weather (temp, rh, wind, radiation, time, lat/lon), metabolicWatts, clothingAdjC, acclimatized | wbgt, wbgtEffective, limitC, level, workMin, restMin, action |
| `POST /forecast` | siteId, raw hourly forecast for next 6 h | corrected WBGT per hour, model version, never lower than raw unless validated |
| `POST /intake` | text or audio URL, language hint | symptoms object (fixed schema), redFlag, extractor used, confidence |
| `POST /baseline` | workerId, recent heart-rate samples | drift flag, reason (stretch) |
| `GET /health` | | model versions loaded |

Fixed symptom schema: `dizziness, headache, nausea, cramps, heavy_sweating, stopped_sweating, confusion, fainting, vomiting, very_thirsty, weakness` (booleans) plus `free_text_other`. Red flags: `confusion, fainting, stopped_sweating, vomiting`.

### backend/ (NestJS modules)

| Module | Responsibility |
| --- | --- |
| `prisma` | client provider using the pg adapter |
| `auth` | JWT login, role guard |
| `sites`, `crews`, `workers`, `shifts` | CRUD, seeded demo data |
| `weather` | Open-Meteo client, stores WeatherSnapshot |
| `risk` | BullMQ job every 15 min per site: fetch weather, call `/forecast` and `/assess` per crew, store RiskAssessment |
| `checkins` | webhook from Twilio (WhatsApp/SMS) and the worker page; calls `/intake`; applies individual uplift |
| `alerts` | level-change rules, cooldown per worker, templates per language, Twilio send, acknowledgement |
| `escalation` | red-flag path: immediate worker + supervisor alert, 998 instruction, needs-check queue |
| `governance` | consent checks, audit interceptor, retention job, field-level filtering by role |
| `reports` | the six requirement-6 metrics |
| `simulation` | replay a past day at speed for the demo |

Main routes: `POST /auth/login`, `GET /sites/:id/outlook`, `GET /crews/:id/plan`, `GET /crews/:id/needs-check`, `POST /checkins`, `POST /webhooks/twilio`, `POST /alerts/:id/ack`, `GET /workers/me/today`, `POST /workers/me/consent`, `GET /reports/site/:id`, `POST /simulation/replay`.

## 6. The risk logic (deterministic, in `ai/rules/`)

1. **WBGT from weather.** Outdoor WBGT needs natural wet-bulb and globe temperature, estimated from air temperature, humidity, wind and solar radiation. Use a tested implementation (thermofeel, or a Liljegren-model package), not hand-written maths. On day 1, pick one and check it against a worked example from its docs.
2. **Effective WBGT** = WBGT + clothing adjustment for the task's PPE.
3. **Limit** from the NIOSH 2016 criteria, by metabolic rate M in watts:
   - acclimatized (REL): `56.7 - 11.5 * log10(M)` degrees C
   - unacclimatized (RAL): `59.9 - 14.1 * log10(M)` degrees C
   - Treat a worker as unacclimatized for their first 14 days on site or after a week away.
4. **Level** from the margin between effective WBGT and the limit. Starting values to tune: GREEN more than 2 C below; YELLOW within 2 C below; ORANGE from the limit to 2 C above; RED more than 2 C above.
5. **Work/rest minutes per hour** per level, taken from the NIOSH work/rest guidance.
6. **Individual uplift:** any reported symptom raises that worker one level; any red flag sets RED and triggers escalation. A drift flag from the wearable raises one level.
7. **Fallback:** if weather, the model or a sensor is unavailable, use the last good forecast and go one level stricter; mark `fallback = true`.

These formulas, the metabolic rates per workload class and the clothing adjustments are written from memory. **Check each against the NIOSH 2016 document (publication 2016-106) and the ACGIH clothing table before coding them, and cite the page in `docs/risk-model.md`.**

## 7. The AI pieces

**Forecast correction (LightGBM).**
- Data: Open-Meteo archive (observed) and its Previous Runs API (forecasts at 0 and 24 hours' lead) for the two seeded sites, May to September 2024 and 2025. Previous Runs data only starts in January 2024. Pulled by `data/pull_open_meteo.py`.
- Target: observed WBGT (computed with the same function as section 6). Features: forecast temp, humidity, wind, radiation, hour, day of year, lead time, site.
- Split: train 2024, test 2025. Report MAE and peak-hour error against the raw forecast.
- Safety rule: serve `max(raw, corrected)` unless the test set shows the corrected value is better on under-prediction too.

**Symptom intake.**
- Speech-to-text for voice notes, then an LLM constrained to the fixed schema. Keep the provider behind one interface (`ai/intake/provider.py`).
- Keyword list of red-flag phrases per language runs in parallel and always wins.
- Invalid JSON, timeout or low confidence: fall back to keywords, then ask the worker the 2-tap question.
- Test set: 40 to 60 phrases per language (English, Arabic, Hindi first), including red flags and tricky negatives ("I am not dizzy"). Target 100% red-flag recall.
- No names or phone numbers are sent to the model.

**Heart-rate baseline (stretch).** Rolling per-worker baseline on the simulated feed; flag slow recovery after a break.

## 8. Schedule, 11 to 15 Nov (revised: submit on Sun 15 Nov)

Revised on 11 Nov to submit five days before the 20 Nov deadline. That leaves four build days, so the scope below is smaller than sections 5 to 7 describe. Where they disagree, this section wins.

| Day | Build | Done when |
| --- | --- | --- |
| Wed 11 (rest of day) | Run `data/pull_open_meteo.py`. Implement `ai/app/rules/wbgt.py`. Verify `limits.py` against NIOSH 2016-106; write `docs/risk-model.md`. | `/assess` returns a level from raw weather; tests pass |
| Thu 12 | Backend: login + role guard, Open-Meteo client, 15-minute risk run (cron, no queue), alert rules with cooldown, red-flag escalation. Evening: train and evaluate the forecast model, add `/forecast`. | a replayed hot day produces level changes and alert rows; MAE vs raw forecast recorded |
| Fri 13 | Symptom intake: `/intake` with LLM extraction, keyword fallback, test set in English, Arabic and Hindi; voice via speech-to-text. `checkins` module and individual uplift. Start `web/`: login and site dashboard. | a Hindi message raises one worker's level; red-flag recall reported |
| Sat 14 | Finish dashboard (6-hour outlook, break plan, needs-check queue). Worker page (level, schedule, check-in, consent). Role filtering + audit log. Replay of a summer 2025 day and metrics. Deploy. | live URL runs the demo script end to end |
| Sun 15 | Docs, 3 to 4 minute demo video, final check against the submission requirements, submit. | submitted |

Thursday live session: 12 Nov. Watch it for submission details.

**Cut from the build (describe as roadmap in the docs, do not claim as built):**

- Heart-rate baseline model and the simulated wearable feed
- Shift-planning assistant and the rotation planner
- Offline caching on the worker page (the forecast-only fallback mode stays)
- Live WhatsApp and SMS through Twilio: replaced by an in-app "worker message" simulator that accepts text or an audio file. Add Twilio only if Saturday finishes early.
- Languages: English, Arabic and Hindi only
- BullMQ and Redis: `@nestjs/schedule` cron instead
- Retention job: documented policy only
- Reports: alert lead time, false-alarm rate, symptom reports and escalations from the replay. Adherence and lost work time need real crews, so state them as pilot metrics.

**Not cut:** `/assess` tests, verified thresholds with citations, the red-flag keyword fallback, the forecast evaluation on held-out 2025 data, role filtering with the audit log, and the assumptions and limitations doc.

**What this costs against the statement:** requirement 4 (field-ready operation) is shown only through fallback mode, and the optional wearable signal in requirement 1 is design only. Say so in the limitations.

**If a day slips:** drop voice input (text only), then the worker page (use the simulator), then the break plan. If the platform allows editing a submission before 20 Nov, use the spare days for Twilio and the wearable model.

## 9. Environment variables

`DATABASE_URL`, `REDIS_URL`, `AI_SERVICE_URL`, `JWT_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `LLM_API_KEY`, `STT_API_KEY`, `PORT`. Add a `.env.example` with names only.

## 10. Open questions

- What do the full submission requirements (shown after registration) ask for beyond prototype, docs and assumptions? Check today; they may change section 8.
- Which LLM and speech-to-text provider do you already have keys for?
- Hosting: one provider for all three services plus Postgres and Redis keeps deployment to an hour.
