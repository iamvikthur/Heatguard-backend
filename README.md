# HeatGuard

Heat-stress early warning for outdoor crews in Abu Dhabi. Built for the Future Health Digital Innovation Challenge 2026, Challenge 07: Climate-Resilient Worker Health.

**Live demo:** https://web-production-59e4348c.up.railway.app

| Account | Sees |
| --- | --- |
| `hse@heatguard.test` | Both sites, all crews; can replay past days |
| `supervisor.a@heatguard.test` | Crew A (rebar), Mussafah Industrial Yard |
| `supervisor.b@heatguard.test` | Crew B (formwork), Mussafah Industrial Yard |
| `supervisor.c@heatguard.test` | Crew C (concrete), KIZAD Logistics Build |

The password is given in the submission form. Open "Replayed day" on a site to see 15 July 2025 as the system would have run it.

## What it does

Every 15 minutes, HeatGuard takes the weather forecast for each site, works out the heat stress (WBGT) and turns it into a schedule for each crew: how many minutes in the hour they may work and how long they must rest, for the next six hours. The limits are the NIOSH 2016 occupational heat criteria, applied to the crew's workload and to where they take their breaks.

- **Supervisors** see each crew's level (GREEN, YELLOW, ORANGE, RED), its schedule, and a "needs check" list of workers to see in person.
- **Workers** get their own schedule and messages in their language (English, Arabic, Hindi) from a personal link, with no app or password. They can report how they feel by tapping symptoms or in their own words. Someone new to the heat, or who reports symptoms, gets a stricter schedule than the rest of the crew.
- **Red flags** (confusion, fainting, vomiting, stopped sweating) start the emergency path at once: the worker is told to stop work and get to a cool place, and the supervisor is told to go to them, cool them and call 998.
- **The evening before**, a planning estimate gives tomorrow's schedule so heavy tasks can be moved earlier or cover arranged. It is an API endpoint (`GET /sites/:id/plan`) with no screen yet.

## Results

From three recorded summers (2024 to 2026), both sites, every shift hour. Full method and caveats in [docs/metrics.md](docs/metrics.md).

- Stop-work (RED) hours are flagged by the evening before, a median of **16.5 to 18 hours** ahead. For the concrete crew, **83 to 96%** of the days that reached RED were flagged.
- A cooled rest area gives back **2 to 2.4 hours of work per 8-hour shift** compared with resting in shade.
- The day-ahead schedule matched the day exactly **72 to 88%** of the time; when it was off on the lenient side (2 to 7% of hours), it was by one 15-minute step.
- The symptom intake reads "I have a headache but have not vomited" correctly in Hindi; a keyword match alone would have raised a false emergency.

## Where the AI is

The schedule itself comes from published formulas, not a model: a heat-stress limit is not something to learn from two summers of data. AI does two narrower jobs, each with a guard around it. See [docs/ai-and-guardrails.md](docs/ai-and-guardrails.md).

1. **Symptom intake.** A language model (OpenAI or Claude, configurable) turns a worker's own words, in any of the three languages, into a fixed list of eleven yes/no symptoms. It never sets a level. A keyword net for the red flags runs alongside it and takes over if the model fails.
2. **Forecast correction for planning.** A model that learns the forecast's recent error at each site and corrects tomorrow's forecast. It switches itself off when the forecast is not biased, and it is used for planning only. An earlier fixed version failed its held-out test; that result is reported, not hidden.

## Documents

| Document | Contents |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Services, data flow, data model, deployment |
| [docs/risk-model.md](docs/risk-model.md) | Every formula and threshold, with its source |
| [docs/ai-and-guardrails.md](docs/ai-and-guardrails.md) | The two AI components, how they can fail and what catches it |
| [docs/metrics.md](docs/metrics.md) | The six outcome metrics, forecast evaluation |
| [docs/governance.md](docs/governance.md) | Roles, consent, privacy, audit, retention |
| [docs/limitations.md](docs/limitations.md) | Assumptions and limitations |
| [DEPLOY.md](DEPLOY.md) | Deploying on Railway |

## Run it locally

Needs Docker, Bun and Python 3.11 or later.

```bash
docker compose up -d postgres                 # Postgres on 5432

cd ai && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m training.train_forecast             # trains the planning model, about a minute
uvicorn app.main:app --port 8000              # set OPENAI_API_KEY etc. first, see ai/README.md

cd backend && bun install                     # copy .env.example to .env and fill it in
bun run db:migrate && bun run db:seed
bun run start:dev                             # http://localhost:5500

cd web && bun install && bun run dev          # http://localhost:3000
```

Tests: `pytest` in `ai/`, `bun run test` in `backend/`.

## Layout

```
ai/        FastAPI: WBGT, limits, schedules, symptom intake, forecast correction
backend/   NestJS + Prisma: auth, 15-minute risk runs, alerts, check-ins, audit
web/       Next.js: supervisor dashboard, worker page
data/      Open-Meteo weather for the two sites, May-Sep 2024-2026
docs/      design, evidence and governance documents
```
