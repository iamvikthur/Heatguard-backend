# HeatGuard AI service

FastAPI service called by the NestJS backend. Contract: `../IMPLEMENTATION_PLAN.md` section 5.

```bash
cd ai
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload --port 8000
```

Symptom intake uses OpenAI or Claude, chosen by `INTAKE_PROVIDER`. Create `ai/.env` (it is gitignored) and export it before starting the service:

```bash
INTAKE_PROVIDER=openai          # or: anthropic

OPENAI_API_KEY=...              # for provider openai, and for voice notes with either provider
OPENAI_INTAKE_MODEL=...         # a current chat model with strict JSON-schema output
OPENAI_STT_MODEL=gpt-transcribe

ANTHROPIC_API_KEY=...           # for provider anthropic
ANTHROPIC_INTAKE_MODEL=...      # a current Claude model with structured outputs
```

```bash
set -a; source .env; set +a
uvicorn app.main:app --reload --port 8000
curl localhost:8000/health           # shows the provider and model in use, never the key
python -m training.evaluate_intake   # optional: accuracy on the test phrases, uses the API
```

Voice notes are always transcribed by OpenAI. With Claude and no OpenAI key, text and tap check-ins work and voice is refused.

Without a key the service still runs: `/intake` falls back to the red-flag keyword net.

Train the forecast model (needs `data/raw`, takes under a minute):

```bash
python -m training.train_forecast
```

Status:

- `/health` and `/assess` work. `/assess` estimates WBGT from weather, or uses `wbgtC` if the request supplies it.
- `/forecast` corrects a 24-hour-ahead forecast. It answers 503 until the model has been trained.
- `/intake` extracts the fixed symptom list from a worker's text or recording. `/plan` gives the adaptive planning estimate.
- `/baseline` (wearable) is not built.
- Sources, assumptions and what is still unverified: `../docs/risk-model.md`. Model results: `../docs/metrics.md`.
