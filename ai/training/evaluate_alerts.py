#!/usr/bin/env python3
"""Evaluates HeatGuard's alerting over three recorded summers, without any people.

For every shift hour (06:00-14:00 Gulf time), May to September 2024-2026, at
both sites and for the three seeded crew workloads, the work/rest rules are run
twice: on the 24-hour-ahead forecast (what the planning estimate gives the evening
before) and on the recorded weather (what the day turned out to be).

Reports:
  - warning: did the day-ahead plan flag the hours that turned out ORANGE or RED,
    how far ahead, and how often it flagged hours that turned out fine
  - lost work time: minutes of rest the schedule imposes per 8-hour shift, with
    breaks in a cooled rest area, in shade, or in the open sun
  - alert burden: how many times a crew's schedule changes during a shift

The live 6-hour outlook cannot be evaluated: the archive holds no same-day
forecasts (see docs/metrics.md). Run from the ai/ folder:
    python -m training.evaluate_alerts
Writes models/alerts_eval.json.
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.rules import limits
from app.rules.wbgt import estimate_shade_wbgt_c, estimate_wbgt_c
from app.schemas import Weather

AI_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = AI_DIR.parent / "data" / "raw"
OUT = AI_DIR / "models" / "alerts_eval.json"

SITES = {"mussafah": (24.35, 54.50), "kizad": (24.72, 54.72)}
GULF = timezone(timedelta(hours=4))
SHIFT_HOURS_UTC = range(2, 10)          # 06:00-14:00 Gulf time, 8 hours
COOLED_REST_WBGT_C = 22.0               # the seeded sites' cooled rest area
# The plan for a day is assumed to reach supervisors at 18:00 Gulf time the evening before.
PLAN_PUBLISHED_GULF_HOUR = 18
# The seeded crews, acclimatized (new arrivals are handled per worker, on top of this).
WORKLOADS = {
    "moderate (formwork, 300 W)": 300,
    "heavy (rebar, 415 W)": 415,
    "very heavy (concrete, 520 W)": 520,
}
VARS = ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "shortwave_radiation", "direct_radiation")


def weather(when: datetime, lat: float, lon: float, vals: list[float]) -> Weather:
    temp, humidity, wind, radiation, direct = vals
    return Weather(valid_at=when, latitude=lat, longitude=lon, temp_c=temp, humidity_pct=humidity,
                   wind_ms=wind, radiation_wm2=radiation, direct_radiation_wm2=direct)


def load_site(slug: str, lat: float, lon: float) -> dict[datetime, dict]:
    """Shift hours with both the day-ahead forecast and the recorded weather."""
    hours: dict[datetime, dict] = {}
    files = sorted(RAW_DIR.glob(f"forecast_{slug}_*.csv"))
    if not files:
        sys.exit(f"No data for {slug} in {RAW_DIR}. Run data/pull_open_meteo.py first.")
    for fc_file in files:
        obs_file = fc_file.with_name(fc_file.name.replace("forecast_", "observed_"))
        with fc_file.open() as f, obs_file.open() as o:
            for fc, obs in zip(csv.DictReader(f), csv.DictReader(o)):
                when = datetime.fromisoformat(fc["time"]).replace(tzinfo=timezone.utc)
                if when.hour not in SHIFT_HOURS_UTC:
                    continue
                try:
                    fc_w = weather(when, lat, lon, [float(fc[f"{v}_previous_day1"]) for v in VARS])
                    obs_w = weather(when, lat, lon, [float(obs[v]) for v in VARS])
                except ValueError:
                    continue  # a missing value in either file
                # WBGT is the slow part, so compute it once per hour.
                hours[when] = {
                    "fc": {"wbgt": estimate_wbgt_c(fc_w)},
                    "obs": {"wbgt": estimate_wbgt_c(obs_w), "shade": estimate_shade_wbgt_c(obs_w)},
                }
    return hours


def schedule(w: dict, watts: int, rest: str) -> tuple[limits.Level, int]:
    """Crew level and work minutes for one hour, as /assess computes them."""
    wbgt = w["wbgt"]
    rest_wbgt = {"cooled": COOLED_REST_WBGT_C, "shade": w.get("shade"), "sun": wbgt}[rest]
    work = limits.work_minutes(wbgt, watts, True, rest_wbgt)
    return limits.classify(wbgt, limits.wbgt_limit_c(watts, True), work), work


def pct(part: int, whole: int) -> float | None:
    return round(100 * part / whole, 1) if whole else None


def warning_stats(rows: list[dict], level_set: set) -> dict:
    """rows: one per shift day, each with the day and its hours as (when, obs_level, fc_level)."""
    danger = warned = flagged = false_alarms = 0
    danger_days = warned_days = 0
    leads: list[float] = []
    for day in rows:
        first = None
        day_flagged = False
        for when, obs_level, fc_level in day["hours"]:
            if obs_level in level_set:
                danger += 1
                first = first or when
                warned += fc_level in level_set
            if fc_level in level_set:
                flagged += 1
                day_flagged = True
                false_alarms += obs_level not in level_set
        if first:
            danger_days += 1
            if day_flagged:
                warned_days += 1
                d = day["day"]
                published = datetime(d.year, d.month, d.day, PLAN_PUBLISHED_GULF_HOUR, tzinfo=GULF) - timedelta(days=1)
                leads.append((first - published).total_seconds() / 3600)
    total = sum(len(day["hours"]) for day in rows)
    return {
        "danger_hours_pct_of_shift": pct(danger, total),
        "danger_days": danger_days,
        "danger_hours_warned_day_ahead_pct": pct(warned, danger),
        "danger_days_warned_day_ahead_pct": pct(warned_days, danger_days),
        "lead_time_hours_median": round(statistics.median(leads), 1) if leads else None,
        "false_alarm_pct_of_flagged_hours": pct(false_alarms, flagged),
    }


def evaluate_year(year: int, data: dict[str, dict[datetime, dict]]) -> dict:
    out = {}
    for name, watts in WORKLOADS.items():
        rows: list[dict] = []
        exact = lenient = strict = 0
        lenient_minutes: list[int] = []
        lost = {"cooled": [], "shade": [], "sun": []}
        changes: list[int] = []

        for slug, hours in data.items():
            by_day: dict = defaultdict(list)
            for when in sorted(hours):
                if when.year == year:
                    by_day[when.date()].append(when)
            for day, whens in by_day.items():
                if len(whens) != len(SHIFT_HOURS_UTC):
                    continue  # incomplete shift
                day_hours = []
                shift_lost = {"cooled": 0, "shade": 0, "sun": 0}
                prev_work, n_changes = None, 0
                for when in whens:
                    row = hours[when]
                    obs_level, obs_work = schedule(row["obs"], watts, "cooled")
                    fc_level, fc_work = schedule(row["fc"], watts, "cooled")
                    day_hours.append((when, obs_level, fc_level))
                    if fc_work == obs_work:
                        exact += 1
                    elif fc_work > obs_work:
                        lenient += 1
                        lenient_minutes.append(fc_work - obs_work)
                    else:
                        strict += 1
                    for rest in shift_lost:
                        shift_lost[rest] += 60 - (obs_work if rest == "cooled" else schedule(row["obs"], watts, rest)[1])
                    if prev_work is not None and obs_work != prev_work:
                        n_changes += 1
                    prev_work = obs_work
                rows.append({"day": day, "hours": day_hours})
                for rest, minutes in shift_lost.items():
                    lost[rest].append(minutes)
                changes.append(n_changes)

        total = exact + lenient + strict
        out[name] = {
            "shifts": len(rows),
            "warning_orange_or_red": warning_stats(rows, {limits.Level.ORANGE, limits.Level.RED}),
            "warning_red": warning_stats(rows, {limits.Level.RED}),
            "day_ahead_schedule": {
                "exact_pct": pct(exact, total),
                "too_lenient_pct": pct(lenient, total),
                "too_lenient_by_minutes_median": statistics.median(lenient_minutes) if lenient_minutes else None,
                "too_strict_pct": pct(strict, total),
            },
            "lost_work_min_per_shift_mean": {r: round(statistics.mean(v), 1) for r, v in lost.items()},
            "schedule_changes_per_shift_mean": round(statistics.mean(changes), 2),
        }
    return out


def main() -> None:
    data = {slug: load_site(slug, lat, lon) for slug, (lat, lon) in SITES.items()}
    years = sorted({w.year for hours in data.values() for w in hours})
    report = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "assumptions": {
            "shift": "06:00-14:00 Gulf time, 8 hours",
            "sites": list(SITES),
            "crews": "acclimatized; individual uplift (new arrivals, symptoms) not included",
            "rest_area_for_warnings": f"cooled, {COOLED_REST_WBGT_C} C WBGT (the seeded sites)",
            "danger": "an hour whose recorded weather gives ORANGE or worse (warning_orange_or_red) or RED (warning_red)",
            "plan_published": f"{PLAN_PUBLISHED_GULF_HOUR}:00 Gulf time the evening before",
            "forecast": "Open-Meteo 24-hour-ahead (previous_day1), raw: the adaptive correction is not applied",
        },
        "years": {str(y): evaluate_year(y, data) for y in years},
    }
    OUT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
