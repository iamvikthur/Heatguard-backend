"""Feature layout shared by training and serving. Keep the order stable."""
from __future__ import annotations

import math
from datetime import datetime

FEATURES = [
    "fc_wbgt",          # WBGT computed from the forecast weather
    "fc_temp",
    "fc_humidity",
    "fc_wind",
    "fc_radiation",
    "fc_direct",
    "hour_sin",         # UTC hour of day, cyclic
    "hour_cos",
    "day_of_year",
    "latitude",
    "longitude",
    "prev_day_wbgt",    # WBGT observed 24 h before the target hour (may be missing)
    "prev_day_error",   # that hour's observed minus forecast WBGT (may be missing)
]


def feature_row(
    *,
    valid_at: datetime,
    latitude: float,
    longitude: float,
    fc_wbgt: float,
    fc_temp: float,
    fc_humidity: float,
    fc_wind: float,
    fc_radiation: float,
    fc_direct: float | None,
    prev_day_wbgt: float | None,
    prev_day_error: float | None,
) -> list[float]:
    hour = valid_at.hour + valid_at.minute / 60
    angle = 2 * math.pi * hour / 24
    nan = float("nan")
    return [
        fc_wbgt,
        fc_temp,
        fc_humidity,
        fc_wind,
        fc_radiation,
        nan if fc_direct is None else fc_direct,
        math.sin(angle),
        math.cos(angle),
        float(valid_at.timetuple().tm_yday),
        latitude,
        longitude,
        nan if prev_day_wbgt is None else prev_day_wbgt,
        nan if prev_day_error is None else prev_day_error,
    ]
