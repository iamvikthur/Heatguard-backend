#!/usr/bin/env python3
"""Train and evaluate the forecast-correction model.

The model learns how far the 24-hour-ahead forecast WBGT is from the WBGT that
was later observed, and corrects tomorrow's forecast by that amount.

  train: summer 2024
  validate: summer 2025, used to choose how cautious the planning model is
  test: summer 2026, used for nothing else (needs the 2026 files in data/raw)

Two models are saved. "best" is the most accurate estimate. "plan" aims high
on purpose: its quantile is the lowest one that misses dangerous heat no more
often than the raw forecast does on the validation shift hours.

"Observed" is Open-Meteo's historical record, which is a weather model's own
analysis, not a ground station. See docs/risk-model.md.

Run from the ai/ folder after data/pull_open_meteo.py:
    python -m training.train_forecast
Writes models/forecast_v1.joblib and models/forecast_v1.json.
"""
from __future__ import annotations

import csv
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor

from app.forecast.features import FEATURES, feature_row
from app.rules.wbgt import estimate_wbgt_c
from app.schemas import Weather

AI_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = AI_DIR.parent / "data" / "raw"
MODEL_DIR = AI_DIR / "models"
SITES = {"mussafah": (24.35, 54.50), "kizad": (24.72, 54.72)}
TRAIN_YEAR, VALIDATION_YEAR, TEST_YEAR = 2024, 2025, 2026
SHIFT_HOURS_UTC = range(2, 10)  # 06:00-14:00 Gulf time
UNDER_MARGIN_C = 1.0            # an under-forecast of more than this counts as a miss
QUANTILES = (0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95)
PARAMS = dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=40,
              l2_regularization=1.0, random_state=0)


def wbgt(when, lat, lon, temp, humidity, wind, radiation, direct):
    return estimate_wbgt_c(
        Weather(valid_at=when, latitude=lat, longitude=lon, temp_c=temp, humidity_pct=humidity,
                wind_ms=wind, radiation_wm2=radiation, direct_radiation_wm2=direct)
    )


def load_site(slug: str, lat: float, lon: float) -> dict[datetime, dict]:
    hours: dict[datetime, dict] = {}
    files = sorted(RAW_DIR.glob(f"forecast_{slug}_*.csv"))
    if not files:
        sys.exit(f"No data for {slug} in {RAW_DIR}. Run data/pull_open_meteo.py first.")
    for fc_file in files:
        obs_file = fc_file.with_name(fc_file.name.replace("forecast_", "observed_"))
        with fc_file.open() as f, obs_file.open() as o:
            for fc, obs in zip(csv.DictReader(f), csv.DictReader(o)):
                if fc["time"] != obs["time"]:
                    sys.exit(f"{fc_file.name} and {obs_file.name} are not aligned")
                try:
                    when = datetime.fromisoformat(fc["time"]).replace(tzinfo=timezone.utc)
                    f_vals = [float(fc[f"{v}_previous_day1"]) for v in
                              ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "shortwave_radiation", "direct_radiation")]
                    o_vals = [float(obs[v]) for v in
                              ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "shortwave_radiation", "direct_radiation")]
                except ValueError:
                    continue  # a missing value in either file
                hours[when] = {
                    "fc": f_vals,
                    "fc_wbgt": wbgt(when, lat, lon, *f_vals),
                    "obs_wbgt": wbgt(when, lat, lon, *o_vals),
                }
    return hours


def build() -> tuple[np.ndarray, np.ndarray, np.ndarray, list[datetime]]:
    X, raw, target, times = [], [], [], []
    for slug, (lat, lon) in SITES.items():
        hours = load_site(slug, lat, lon)
        for when, row in sorted(hours.items()):
            prev = hours.get(when - timedelta(hours=24))
            temp, humidity, wind, radiation, direct = row["fc"]
            X.append(feature_row(
                valid_at=when, latitude=lat, longitude=lon, fc_wbgt=row["fc_wbgt"], fc_temp=temp,
                fc_humidity=humidity, fc_wind=wind, fc_radiation=radiation, fc_direct=direct,
                prev_day_wbgt=prev["obs_wbgt"] if prev else None,
                prev_day_error=prev["obs_wbgt"] - prev["fc_wbgt"] if prev else None,
            ))
            raw.append(row["fc_wbgt"])
            target.append(row["obs_wbgt"])
            times.append(when)
    return np.array(X), np.array(raw), np.array(target), times


def score(pred: np.ndarray, truth: np.ndarray) -> dict:
    err = pred - truth
    return {
        "n": int(len(err)),
        "mae_c": round(float(np.mean(np.abs(err))), 3),
        "rmse_c": round(float(np.sqrt(np.mean(err ** 2))), 3),
        "bias_c": round(float(np.mean(err)), 3),
        "under_by_more_than_1c_pct": round(float(np.mean(err < -UNDER_MARGIN_C) * 100), 2),
    }


def miss_rate(pred: np.ndarray, truth: np.ndarray) -> float:
    return float(np.mean(pred - truth < -UNDER_MARGIN_C))


def fit(X, residual, quantile: float | None = None):
    if quantile is None:
        return HistGradientBoostingRegressor(**PARAMS).fit(X, residual)
    return HistGradientBoostingRegressor(loss="quantile", quantile=quantile, **PARAMS).fit(X, residual)


def report_for(mask, shift, raw, best, plan, truth) -> dict:
    out = {}
    for label, m in (("all_hours", mask), ("shift_hours", mask & shift)):
        out[label] = {
            "raw_forecast": score(raw[m], truth[m]),
            "best": score(best[m], truth[m]),
            "plan": score(plan[m], truth[m]),
        }
    return out


def main() -> None:
    X, raw, truth, times = build()
    years = np.array([t.year for t in times])
    shift = np.array([t.hour in SHIFT_HOURS_UTC for t in times])
    train, validation, test = years == TRAIN_YEAR, years == VALIDATION_YEAR, years == TEST_YEAR
    if not train.any() or not validation.any():
        sys.exit("Need both the 2024 and 2025 files in data/raw.")
    residual = truth - raw

    # 1. Choose the planning quantile on the validation year only.
    target = miss_rate(raw[validation & shift], truth[validation & shift])
    chosen = QUANTILES[-1]
    sweep = []
    for q in QUANTILES:
        pred = raw + fit(X[train], residual[train], q).predict(X)
        rate = miss_rate(pred[validation & shift], truth[validation & shift])
        sweep.append({"quantile": q, "shift_miss_pct": round(rate * 100, 2)})
        if rate <= target:
            chosen = q
            break

    # 2. Validation report: models trained on 2024 only.
    best = raw + fit(X[train], residual[train]).predict(X)
    plan = raw + fit(X[train], residual[train], chosen).predict(X)
    meta = {
        "version": "forecast_v1",
        "lead_time_hours": 24,
        "sites": list(SITES),
        "features": FEATURES,
        "sklearn_version": sklearn.__version__,
        "plan_quantile": chosen,
        "plan_quantile_search": sweep,
        "raw_shift_miss_pct_validation": round(target * 100, 2),
        "validation": {
            "trained_on": f"summer {TRAIN_YEAR}, {int(train.sum())} hours",
            "evaluated_on": f"summer {VALIDATION_YEAR}, {int(validation.sum())} hours",
            "note": "The plan quantile was chosen on this data, so its numbers here are optimistic.",
            **report_for(validation, shift, raw, best, plan, truth),
        },
    }

    # 3. Final models. With 2026 data: train on 2024 + 2025 and test once on 2026.
    if test.any():
        fit_on = train | validation
        best_model = fit(X[fit_on], residual[fit_on])
        plan_model = fit(X[fit_on], residual[fit_on], chosen)
        meta["test"] = {
            "trained_on": f"summers {TRAIN_YEAR} and {VALIDATION_YEAR}, {int(fit_on.sum())} hours",
            "evaluated_on": f"summer {TEST_YEAR}, {int(test.sum())} hours",
            **report_for(test, shift, raw, raw + best_model.predict(X), raw + plan_model.predict(X), truth),
        }
    else:
        best_model = fit(X[train], residual[train])
        plan_model = fit(X[train], residual[train], chosen)
        meta["test"] = None
        print("No 2026 data found: re-run data/pull_open_meteo.py to get an untouched test year.", file=sys.stderr)

    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump({"best": best_model, "plan": plan_model, "features": FEATURES, "meta": meta},
                MODEL_DIR / "forecast_v1.joblib")
    (MODEL_DIR / "forecast_v1.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps({k: meta[k] for k in ("plan_quantile", "plan_quantile_search", "validation", "test")}, indent=2))


if __name__ == "__main__":
    main()
