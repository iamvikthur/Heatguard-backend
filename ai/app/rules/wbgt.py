"""Estimate outdoor WBGT from weather data.

Uses the Liljegren et al. (2008) physical model as implemented in ECMWF's
thermofeel library. This is the model behind the Argonne WBGT calculator that
the OSHA Technical Manual points to when no on-site WBGT meter is available.
The heat maths is not re-implemented here; this module only prepares inputs.

Assumptions (also listed in docs/risk-model.md):
- Wind is the 10 m wind speed; thermofeel scales it to sensor height.
- Radiation values are means over the hour ending at valid_at (the Open-Meteo
  convention), so the sun position is taken 30 minutes before valid_at.
- If direct radiation is not supplied, DEFAULT_DIRECT_FRACTION is assumed.
- If surface pressure is not supplied, sea-level pressure is assumed.
- Work is in the open sun, away from hot surfaces. Shade removes only the
  direct beam.
"""
from __future__ import annotations

import math
from datetime import timedelta, timezone

import thermofeel
from astral import Observer
from astral.sun import elevation

from app.schemas import Weather

DEFAULT_DIRECT_FRACTION = 0.65
SEA_LEVEL_PRESSURE_HPA = 1013.25
RADIATION_HALF_WINDOW = timedelta(minutes=30)


def cos_solar_zenith(latitude: float, longitude: float, when) -> float:
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    observer = Observer(latitude=latitude, longitude=longitude)
    elev_deg = elevation(observer, when, with_refraction=False)
    return max(0.0, math.sin(math.radians(elev_deg)))


def direct_fraction(weather: Weather) -> float:
    if weather.radiation_wm2 <= 0:
        return 0.0
    if weather.direct_radiation_wm2 is None:
        return DEFAULT_DIRECT_FRACTION
    return min(1.0, max(0.0, weather.direct_radiation_wm2 / weather.radiation_wm2))


def _liljegren_c(weather: Weather, radiation_wm2: float, fdir: float) -> float:
    cossza = cos_solar_zenith(
        weather.latitude, weather.longitude, weather.valid_at - RADIATION_HALF_WINDOW
    )
    wbgt_k = thermofeel.calculate_wbgt_liljegren(
        t2_k=weather.temp_c + 273.15,
        rh=weather.humidity_pct,
        pressure=weather.pressure_hpa or SEA_LEVEL_PRESSURE_HPA,
        va=weather.wind_ms,
        ssrd=radiation_wm2,
        fdir=fdir,
        cossza=cossza,
    )
    wbgt_c = float(wbgt_k) - 273.15
    if math.isnan(wbgt_c):
        raise ValueError("WBGT model did not converge for these inputs")
    return wbgt_c


def estimate_wbgt_c(weather: Weather) -> float:
    """WBGT for a worker in the open sun."""
    return _liljegren_c(weather, weather.radiation_wm2, direct_fraction(weather))


def estimate_shade_wbgt_c(weather: Weather) -> float:
    """WBGT under simple shade: the direct beam is blocked, diffuse light and
    the same air temperature, humidity and wind remain. Never above the open-sun
    value. A cooled rest area would be lower still; pass a measured value instead.
    """
    diffuse = weather.radiation_wm2 * (1.0 - direct_fraction(weather))
    return min(_liljegren_c(weather, diffuse, 0.0), estimate_wbgt_c(weather))
