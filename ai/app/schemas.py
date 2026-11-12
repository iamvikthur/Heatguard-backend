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
    # Take this many 15-minute steps off the permitted work time (a worker who reported symptoms).
    stricter_steps: int = Field(default=0, ge=0, le=4)


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


class Symptoms(BaseModel):
    """The fixed symptom list. Field names are part of the contract with the model."""

    model_config = ConfigDict(extra="forbid", strict=True)

    dizziness: bool = False
    headache: bool = False
    nausea: bool = False
    cramps: bool = False
    heavy_sweating: bool = False
    stopped_sweating: bool = False
    confusion: bool = False
    fainting: bool = False
    vomiting: bool = False
    very_thirsty: bool = False
    weakness: bool = False


class IntakeRequest(Wire):
    # The worker's message, or a recording of it. Send one of the two.
    text: str | None = None
    audio_base64: str | None = None
    audio_filename: str | None = None


class IntakeResponse(Wire):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, protected_namespaces=())

    transcript: str
    from_audio: bool
    symptoms: Symptoms
    # Names of the symptoms that are true, and which of them are red flags.
    reported: list[str]
    red_flags: list[str]
    red_flag: bool
    # Red flags found by the keyword net, whatever the model said.
    keyword_flags: list[str]
    # Keyword hits the model did not confirm. Not an emergency, but someone must check in person.
    disputed_flags: list[str]
    needs_urgent_check: bool
    # LLM: the model's answer was used. KEYWORD: the model failed and only keywords were used.
    extractor: str
    model_error: str | None
    needs_tap_checkin: bool
