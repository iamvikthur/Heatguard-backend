# Deploying HeatGuard on Railway

Everything runs in one Railway project: four services, all built from this repository.

| Service | What it is | Config file |
| --- | --- | --- |
| `Postgres` | Railway PostgreSQL database | — |
| `ai` | FastAPI risk and intake service | `/ai/railway.toml` |
| `backend` | NestJS API, risk timer, alerts | `/backend/railway.toml` |
| `web` | Next.js dashboard and worker pages | `/web/railway.toml` |

Each image is built from the repository root, because the backend replays and the
AI training both read `data/raw`. The AI image trains the forecast model during the
build (about 35 seconds), so the model always matches the installed scikit-learn.
The backend runs `prisma migrate deploy` before it starts.

## Before the first deploy

1. Create any pending migration locally and commit it. Production only applies
   migrations that exist in `backend/prisma/migrations`.
2. Push to GitHub.

## Create the project

1. New project, then **Deploy from GitHub repo**, and pick this repository. Rename
   the service it creates to `ai`.
2. Add two more services from the same repo, named `backend` and `web`.
3. Add a database: **New**, then **Database**, then **PostgreSQL**. Keep the name `Postgres`.
4. On each of `ai`, `backend` and `web`, open **Settings**:
   - Leave **Root Directory** empty (the repository root).
   - Set **Config file path** to that service's `railway.toml` from the table above.
5. On `backend` and `web`, under **Networking**, click **Generate Domain**.
   `ai` stays private; only the backend talks to it.

The service names matter: the variables below refer to them.

## Variables

Paste these into each service's **Variables** tab (the Raw Editor accepts them as is).
`${{ ... }}` values are Railway references and fill themselves in.

### ai

```
PORT=8000
INTAKE_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_INTAKE_MODEL=gpt-5.4-mini
OPENAI_STT_MODEL=gpt-transcribe
# Only needed with INTAKE_PROVIDER=anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_INTAKE_MODEL=claude-haiku-5-5
```

### backend

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
AI_SERVICE_URL=http://${{ai.RAILWAY_PRIVATE_DOMAIN}}:8000
WEB_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
WEB_BASE_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
JWT_SECRET=<output of: openssl rand -hex 32>
SEED_PASSWORD=<demo password for the seeded accounts>
RISK_INTERVAL_MIN=15
```

### web

```
NEXT_PUBLIC_API_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}
```

`NEXT_PUBLIC_API_URL` is baked in at build time. If the backend domain changes,
redeploy `web`.

## Deploy and seed

1. Deploy `ai` first, then `backend`, then `web`.
2. Seed the demo data once, from a shell inside the backend container:

   ```bash
   railway ssh --service backend
   bun run db:seed
   ```

   Seeding wipes the seeded tables. Run it again only for a clean slate.
3. Sign in on the `web` domain with a seeded account and `SEED_PASSWORD`.

## Checks

- `ai`: the deploy log ends with the training summary, and the healthcheck on
  `/health` passes. Its response lists `"forecast": "forecast_v1"`.
- `backend`: the log shows `prisma migrate deploy` applying migrations, then Nest
  starting.
- `web`: the dashboard loads and the browser console shows no CORS errors. A CORS
  error means `WEB_ORIGIN` does not match the web domain exactly.

## Notes

- Worker sign-in links are built from `WEB_BASE_URL`. Links issued before it was set
  point at the wrong host; issue new ones.
- `data/raw` is Open-Meteo data (CC BY 4.0). Refresh it with
  `python3 data/pull_open_meteo.py`, commit, and push; both `ai` and `backend` rebuild.
- The risk timer runs inside the backend, so keep a single backend replica.
