"""Serves the forecast-correction model trained by training/train_forecast.py."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np

from app.forecast.features import FEATURES, feature_row
from app.rules.wbgt import estimate_wbgt_c
from app.schemas import ForecastHour, ForecastHourResult

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "forecast_v1.joblib"


class ModelNotTrained(RuntimeError):
    pass


@lru_cache(maxsize=1)
def load_model() -> dict:
    if not MODEL_PATH.exists():
        raise ModelNotTrained("Forecast model not found. Run: python -m training.train_forecast")
    bundle = joblib.load(MODEL_PATH)
    if bundle.get("features") != FEATURES:
        raise ModelNotTrained("Forecast model was trained with a different feature list. Retrain it.")
    return bundle


def model_version() -> str | None:
    try:
        return load_model()["meta"]["version"]
    except ModelNotTrained:
        return None


def correct(hours: list[ForecastHour]) -> tuple[str, list[ForecastHourResult]]:
    """Corrects 24-hour-ahead forecast hours.

    best: the most accurate estimate. plan: a deliberately cautious value for
    scheduling. The plan value is never below the raw forecast, so the model
    can only make a plan stricter, never looser.
    """
    bundle = load_model()
    raw = [estimate_wbgt_c(h.weather) for h in hours]
    X = np.array([
        feature_row(
            valid_at=h.weather.valid_at,
            latitude=h.weather.latitude,
            longitude=h.weather.longitude,
            fc_wbgt=r,
            fc_temp=h.weather.temp_c,
            fc_humidity=h.weather.humidity_pct,
            fc_wind=h.weather.wind_ms,
            fc_radiation=h.weather.radiation_wm2,
            fc_direct=h.weather.direct_radiation_wm2,
            prev_day_wbgt=h.prev_day_wbgt_c,
            prev_day_error=h.prev_day_error_c,
        )
        for h, r in zip(hours, raw)
    ])
    best = np.array(raw) + bundle["best"].predict(X)
    plan = np.maximum(np.array(raw), np.array(raw) + bundle["plan"].predict(X))
    results = [
        ForecastHourResult(
            valid_at=h.weather.valid_at,
            wbgt_raw_c=round(r, 2),
            wbgt_best_c=round(float(b), 2),
            wbgt_plan_c=round(float(p), 2),
        )
        for h, r, b, p in zip(hours, raw, best, plan)
    ]
    return bundle["meta"]["version"], results
