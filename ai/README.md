# HeatGuard AI service

FastAPI service called by the NestJS backend. Contract: `../IMPLEMENTATION_PLAN.md` section 5.

```bash
cd ai
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload --port 8000
```

Status:

- `/health` and `/assess` work. `/assess` estimates WBGT from weather, or uses `wbgtC` if the request supplies it.
- `/forecast`, `/intake` and `/baseline` are not started.
- Sources, assumptions and what is still unverified: `../docs/risk-model.md`.
