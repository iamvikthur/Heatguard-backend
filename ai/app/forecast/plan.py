"""Tomorrow's planning estimate, using the adaptive correction."""
from __future__ import annotations

from datetime import timedelta

import numpy as np

from app.forecast import adaptive
from app.forecast.features import feature_row
from app.rules.wbgt import estimate_wbgt_c
from app.schemas import PlanHour, PlanRequest, PlanResponse, Weather

VERSION = "adaptive_v1"


def _features(weather: Weather, fc_wbgt: float, known: dict) -> list[float]:
    prev = known.get(weather.valid_at - timedelta(hours=24))
    return feature_row(
        valid_at=weather.valid_at,
        latitude=weather.latitude,
        longitude=weather.longitude,
        fc_wbgt=fc_wbgt,
        fc_temp=weather.temp_c,
        fc_humidity=weather.humidity_pct,
        fc_wind=weather.wind_ms,
        fc_radiation=weather.radiation_wm2,
        fc_direct=weather.direct_radiation_wm2,
        prev_day_wbgt=prev[1] if prev else None,
        prev_day_error=prev[1] - prev[0] if prev else None,
    )


def make_plan(req: PlanRequest) -> PlanResponse:
    # (forecast WBGT, observed WBGT) for every past hour we were given.
    known = {
        h.forecast.valid_at: (estimate_wbgt_c(h.forecast), estimate_wbgt_c(h.observed))
        for h in req.history
        if h.forecast.valid_at == h.observed.valid_at
    }

    first_target = min(t.valid_at for t in req.target)
    day_start = first_target.replace(hour=0, minute=0, second=0, microsecond=0)
    # Learn only from hours whose outcome was known a full day before the planned
    # day starts, and no older than the window. This matches the evaluation.
    newest = day_start - timedelta(days=1)
    oldest = day_start - timedelta(days=adaptive.WINDOW_DAYS + 1)
    window = [h.forecast for h in req.history if h.forecast.valid_at in known and oldest <= h.forecast.valid_at < newest]

    raw = [estimate_wbgt_c(t) for t in req.target]
    X_target = np.array([_features(t, r, known) for t, r in zip(req.target, raw)])

    if window:
        X_window = np.array([_features(w, known[w.valid_at][0], known) for w in window])
        residuals = np.array([known[w.valid_at][1] - known[w.valid_at][0] for w in window])
        delta, active = adaptive.correction(X_window, residuals, X_target, min_hours=adaptive.MIN_HOURS_ONE_SITE)
        bias = round(float(np.mean(residuals)), 2)
    else:
        delta, active, bias = np.zeros(len(raw)), False, None

    return PlanResponse(
        model_version=VERSION,
        active=active,
        history_hours_used=len(window),
        window_bias_c=bias,
        hours=[
            PlanHour(valid_at=t.valid_at, wbgt_raw_c=round(r, 2), wbgt_plan_c=round(r + float(d), 2))
            for t, r, d in zip(req.target, raw, delta)
        ],
    )
