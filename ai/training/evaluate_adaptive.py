#!/usr/bin/env python3
"""Walk-forward evaluation of the adaptive forecast correction.

For every week of each summer, the model is fitted only on the preceding
45 days (ending a full day before the week starts, so nothing from the future
or from the forecast's own lead time leaks in) and then scored on that week.

Run from the ai/ folder:
    python -m training.evaluate_adaptive
Writes models/adaptive_v1.json.

Honesty note: the window, quantile and gate were settled after looking at all
three summers, so there is no untouched test year for this version.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np

from app.forecast import adaptive
from app.forecast.features import feature_row
from training.train_forecast import MODEL_DIR, SHIFT_HOURS_UTC, SITES, load_site, score

YEARS = (2024, 2025, 2026)


def build():
    rows = []
    for slug, (lat, lon) in SITES.items():
        hours = load_site(slug, lat, lon)
        for when, row in hours.items():
            prev = hours.get(when - timedelta(hours=24))
            temp, humidity, wind, radiation, direct = row["fc"]
            features = feature_row(
                valid_at=when, latitude=lat, longitude=lon, fc_wbgt=row["fc_wbgt"], fc_temp=temp,
                fc_humidity=humidity, fc_wind=wind, fc_radiation=radiation, fc_direct=direct,
                prev_day_wbgt=prev["obs_wbgt"] if prev else None,
                prev_day_error=prev["obs_wbgt"] - prev["fc_wbgt"] if prev else None,
            )
            rows.append((when, features, row["fc_wbgt"], row["obs_wbgt"]))
    rows.sort(key=lambda r: r[0])
    times = [r[0] for r in rows]
    return (times, np.array([t.timestamp() for t in times]), np.array([r[1] for r in rows]),
            np.array([r[2] for r in rows]), np.array([r[3] for r in rows]))


def main() -> None:
    times, stamp, X, raw, truth = build()
    residual = truth - raw
    pred = raw.copy()
    weeks = {year: [] for year in YEARS}

    for year in YEARS:
        day = datetime(year, 5, 1, tzinfo=timezone.utc)
        end = datetime(year, 10, 1, tzinfo=timezone.utc)
        while day < end:
            block = (stamp >= day.timestamp()) & (stamp < (day + timedelta(days=adaptive.RETRAIN_DAYS)).timestamp())
            window = ((stamp >= (day - timedelta(days=adaptive.WINDOW_DAYS + 1)).timestamp())
                      & (stamp < (day - timedelta(days=1)).timestamp()))
            if block.any():
                delta, active = adaptive.correction(X[window], residual[window], X[block])
                pred[block] = raw[block] + delta
                weeks[year].append(active)
            day += timedelta(days=adaptive.RETRAIN_DAYS)

    years = np.array([t.year for t in times])
    shift = np.array([t.hour in SHIFT_HOURS_UTC for t in times])
    report = {
        "version": "adaptive_v1",
        "settings": {"window_days": adaptive.WINDOW_DAYS, "retrain_days": adaptive.RETRAIN_DAYS,
                     "quantile": adaptive.QUANTILE, "gate_c": adaptive.GATE_C},
        "note": "Settings were chosen after looking at all three summers; no untouched test year remains.",
        "years": {},
    }
    for year in YEARS:
        mask = years == year
        if not mask.any():
            continue
        report["years"][str(year)] = {
            "weeks_switched_on": f"{sum(weeks[year])} of {len(weeks[year])}",
            "all_hours": {"raw_forecast": score(raw[mask], truth[mask]), "adaptive": score(pred[mask], truth[mask])},
            "shift_hours": {"raw_forecast": score(raw[mask & shift], truth[mask & shift]),
                            "adaptive": score(pred[mask & shift], truth[mask & shift])},
        }
    MODEL_DIR.mkdir(exist_ok=True)
    (MODEL_DIR / "adaptive_v1.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
