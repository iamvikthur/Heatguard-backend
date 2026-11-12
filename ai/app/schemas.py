"""Request and response shapes shared with the NestJS backend.

Field names are camelCase on the wire to match the backend.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Level(str, Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    ORANGE = "ORANGE"
    RED = "RED"


class Weather(Wire):
    valid_at: datetime
    latitude: float
    longitude: float
    temp_c: float
    humidity_pct: float = Field(ge=0, le=100)
    wind_ms: float = Field(ge=0)
    # Global horizontal (shortwave) radiation.
    radiation_wm2: float = Field(ge=0)
    # Direct part of the above on the horizontal plane. Optional but recommended.
    direct_radiation_wm2: float | None = Field(default=None, ge=0)
    pressure_hpa: float | None = Field(default=None, gt=0)


class AssessRequest(Wire):
    weather: Weather
    metabolic_watts: float = Field(gt=0)
    clothing_adj_c: float = 0.0
    acclimatized: bool = True
    # Optional override: skip the weather-to-WBGT estimate (tests, sensor data).
    wbgt_c: float | None = None
    # Where rest breaks are taken. True: shade (direct sun blocked).
    rest_in_shade: bool = True
    # Optional measured WBGT of the rest area, e.g. a cooled cabin.
    rest_wbgt_c: float | None = None
    # Degraded mode (stale weather, missing model): make the level one step stricter.
    fallback: bool = False


class AssessResponse(Wire):
    wbgt_c: float
    wbgt_effective_c: float
    limit_c: float
    margin_c: float
    level: Level
    work_min: int
    rest_min: int
    # WBGT assumed for rest breaks, before the clothing adjustment.
    rest_wbgt_c: float
    # Work minutes if breaks were taken in the open sun instead.
    work_min_rest_in_sun: int
    action: str


class ForecastHour(Wire):
    """One hour of a 24-hour-ahead forecast, with yesterday's outcome when known."""

    weather: Weather
    # WBGT observed 24 hours before this hour, and that hour's observed minus forecast WBGT.
    prev_day_wbgt_c: float | None = None
    prev_day_error_c: float | None = None


class ForecastRequest(Wire):
    hours: list[ForecastHour] = Field(min_length=1, max_length=72)


class ForecastHourResult(Wire):
    valid_at: datetime
    wbgt_raw_c: float
    # Most accurate estimate.
    wbgt_best_c: float
    # Cautious value for scheduling; never below the raw forecast.
    wbgt_plan_c: float


class ForecastResponse(Wire):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, protected_namespaces=())

    model_version: str
    hours: list[ForecastHourResult]


class HistoryHour(Wire):
    """A past hour: what was forecast for it 24 hours ahead, and what was observed."""

    forecast: Weather
    observed: Weather


class PlanRequest(Wire):
    # Recent hours for the same site, ideally the last 46 days.
    history: list[HistoryHour] = Field(max_length=24 * 60)
    # The 24-hour-ahead forecast for the day being planned.
    target: list[Weather] = Field(min_length=1, max_length=48)


class PlanHour(Wire):
    valid_at: datetime
    wbgt_raw_c: float
    # Planning estimate. Equal to the raw value when the correction is switched off.
    wbgt_plan_c: float


class PlanResponse(Wire):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, protected_namespaces=())

    model_version: str
    # False when recent history is too short or shows no clear forecast bias.
    active: bool
    history_hours_used: int
    # Mean observed minus forecast WBGT over the hours used, or null when none.
    window_bias_c: float | None
    hours: list[PlanHour]
