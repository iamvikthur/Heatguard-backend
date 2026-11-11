"""Deterministic heat-stress rules. No model output may change a level here.

Sources and verification status are recorded in docs/risk-model.md. In short:
- Limit equations: the ACGIH TLV / NIOSH REL form for acclimatized workers and
  the action-limit / RAL form for unacclimatized workers. They give slightly
  lower (stricter) limits than the worked example in NIOSH 2016-106.
- Work/rest: the hourly time-weighted-average method used by NIOSH and ACGIH,
  averaging both WBGT and metabolic rate. Rest is at the resting metabolic
  rate, in shade by default.
- Level names and their cut-offs are HeatGuard design choices, not NIOSH's.
"""
from __future__ import annotations

import math

from app.schemas import Level

# (intercept, slope) of limit_c = intercept - slope * log10(watts)
REL = (56.7, 11.5)  # acclimatized
RAL = (59.9, 14.1)  # unacclimatized

REST_WATTS = 115.0  # resting metabolic rate, OSHA workload table
WORK_STEP_MIN = 15  # schedules are given in quarter hours
YELLOW_BAND_C = 2.0  # full work allowed, but within this margin of the limit

ACTIONS = {
    Level.GREEN: "HYDRATE",
    Level.YELLOW: "REST",
    Level.ORANGE: "REDUCE",
    Level.RED: "ESCALATE",
}


def _coefficients(acclimatized: bool) -> tuple[float, float]:
    return REL if acclimatized else RAL


def wbgt_limit_c(metabolic_watts: float, acclimatized: bool) -> float:
    """Exposure limit in degrees C WBGT for an hourly average metabolic rate."""
    if metabolic_watts <= 0:
        raise ValueError("metabolic_watts must be positive")
    intercept, slope = _coefficients(acclimatized)
    return intercept - slope * math.log10(metabolic_watts)


def work_minutes(
    wbgt_effective_c: float,
    metabolic_watts: float,
    acclimatized: bool,
    rest_wbgt_effective_c: float | None = None,
) -> int:
    """Longest work time per hour, in 15-minute steps, that keeps the hour
    within the limit. The rest of the hour is rest at REST_WATTS.

    The hour is judged on its time-weighted averages of both WBGT and
    metabolic rate, so a cooler rest place (shade, a cooled cabin) earns more
    work time. If rest_wbgt_effective_c is None, rest is in the same heat as
    the work.
    """
    if metabolic_watts <= 0:
        raise ValueError("metabolic_watts must be positive")
    rest_wbgt = wbgt_effective_c if rest_wbgt_effective_c is None else rest_wbgt_effective_c
    for work in range(60, 0, -WORK_STEP_MIN):
        share = work / 60
        twa_watts = share * metabolic_watts + (1 - share) * REST_WATTS
        twa_wbgt = share * wbgt_effective_c + (1 - share) * rest_wbgt
        if twa_wbgt <= wbgt_limit_c(twa_watts, acclimatized):
            return work
    return 0


def classify(wbgt_effective_c: float, limit_c: float, work_min: int) -> Level:
    """GREEN: full work with margin. YELLOW: full work, close to the limit.
    ORANGE: 30 to 45 minutes of work per hour. RED: 15 minutes or none."""
    if work_min >= 60:
        return Level.GREEN if wbgt_effective_c < limit_c - YELLOW_BAND_C else Level.YELLOW
    if work_min >= 30:
        return Level.ORANGE
    return Level.RED


_ORDER = [Level.GREEN, Level.YELLOW, Level.ORANGE, Level.RED]


def raise_level(level: Level, steps: int = 1) -> Level:
    """Make a level stricter. Used for symptoms and fallback mode."""
    return _ORDER[min(_ORDER.index(level) + steps, len(_ORDER) - 1)]
