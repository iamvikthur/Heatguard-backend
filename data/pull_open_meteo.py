#!/usr/bin/env python3
"""Download training data for the HeatGuard forecast-correction model.

For each site and each summer month it saves two CSV files under data/raw/:
  observed_<site>_<yyyy-mm>.csv   Open-Meteo Historical Weather API (what happened)
  forecast_<site>_<yyyy-mm>.csv   Open-Meteo Previous Runs API (what was forecast)

The forecast file holds each variable at two lead times:
  *_previous_day0  the most recent model run for that hour
  *_previous_day1  the value predicted 24 hours before that hour

Previous Runs data starts in January 2024, so the usable summers are 2024
(train) and 2025 (test).

Standard library only. Run from the HeatGuard folder:
    python3 data/pull_open_meteo.py
Files that already exist are skipped, so it is safe to re-run.
"""
from __future__ import annotations

import calendar
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Keep in step with backend/prisma/seed.ts.
SITES = {
    "mussafah": (24.35, 54.50),
    "kizad": (24.72, 54.72),
}
YEARS = (2024, 2025)
MONTHS = (5, 6, 7, 8, 9)  # May to September

VARIABLES = [
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "shortwave_radiation",
    "direct_radiation",
    "diffuse_radiation",
]
LEADS = (0, 1)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
OUT_DIR = Path(__file__).resolve().parent / "raw"
PAUSE_SECONDS = 1.5  # stay well inside the free tier


def fetch(url: str, params: dict) -> dict:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(full, timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", "replace")[:300]
            if err.code == 429 and attempt < 3:
                wait = 30 * (attempt + 1)
                print(f"  rate limited, waiting {wait}s")
                time.sleep(wait)
                continue
            sys.exit(f"HTTP {err.code} from {full}\n{body}")
        except urllib.error.URLError as err:
            if attempt < 3:
                time.sleep(5)
                continue
            sys.exit(f"Could not reach {url}: {err}")
    sys.exit(f"Gave up on {full}")


def save_hourly(payload: dict, path: Path) -> int:
    hourly = payload.get("hourly")
    if not hourly or "time" not in hourly:
        sys.exit(f"Unexpected response for {path.name}: {str(payload)[:300]}")
    columns = list(hourly.keys())
    rows = zip(*(hourly[c] for c in columns))
    with path.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(columns)
        writer.writerows(rows)
    return len(hourly["time"])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    forecast_vars = [f"{v}_previous_day{n}" for v in VARIABLES for n in LEADS]

    for site, (lat, lon) in SITES.items():
        for year in YEARS:
            for month in MONTHS:
                last_day = calendar.monthrange(year, month)[1]
                common = {
                    "latitude": lat,
                    "longitude": lon,
                    "start_date": f"{year}-{month:02d}-01",
                    "end_date": f"{year}-{month:02d}-{last_day:02d}",
                    "wind_speed_unit": "ms",
                    "timezone": "GMT",
                }
                jobs = (
                    ("observed", ARCHIVE_URL, VARIABLES),
                    ("forecast", PREVIOUS_RUNS_URL, forecast_vars),
                )
                for kind, url, variables in jobs:
                    path = OUT_DIR / f"{kind}_{site}_{year}-{month:02d}.csv"
                    if path.exists():
                        print(f"skip  {path.name}")
                        continue
                    payload = fetch(url, {**common, "hourly": ",".join(variables)})
                    n = save_hourly(payload, path)
                    print(f"saved {path.name} ({n} hours)")
                    time.sleep(PAUSE_SECONDS)

    print(f"Done. Files are in {OUT_DIR}")


if __name__ == "__main__":
    main()
