import math

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.rules import limits
from app.schemas import Level

client = TestClient(app)

WEATHER = {
    "validAt": "2025-07-15T08:00:00Z",
    "latitude": 24.35,
    "longitude": 54.5,
    "tempC": 41.0,
    "humidityPct": 45.0,
    "windMs": 3.0,
    "radiationWm2": 850.0,
}


def test_limit_is_lower_for_heavier_work():
    assert limits.wbgt_limit_c(415, True) < limits.wbgt_limit_c(180, True)


def test_limit_is_lower_when_unacclimatized():
    for watts in (180, 300, 415, 520):
        assert limits.wbgt_limit_c(watts, False) < limits.wbgt_limit_c(watts, True)


def test_limit_formula_values():
    assert limits.wbgt_limit_c(300, True) == pytest.approx(56.7 - 11.5 * math.log10(300))
    assert limits.wbgt_limit_c(300, False) == pytest.approx(59.9 - 14.1 * math.log10(300))


def test_limits_are_not_looser_than_the_niosh_worked_example():
    # NIOSH 2016-106: 348.9 W for 60 min/h meets the REL at 27.8 C and the RAL at 25 C.
    assert limits.wbgt_limit_c(348.9, True) <= 27.8
    assert limits.wbgt_limit_c(348.9, False) <= 25.0
    assert limits.wbgt_limit_c(348.9, True) == pytest.approx(27.8, abs=0.5)


def test_limit_rejects_non_positive_rate():
    with pytest.raises(ValueError):
        limits.wbgt_limit_c(0, True)


def test_full_work_below_the_limit():
    limit = limits.wbgt_limit_c(300, True)
    assert limits.work_minutes(limit - 0.1, 300, True) == 60


def test_work_minutes_fall_as_heat_rises():
    minutes = [limits.work_minutes(w, 415, True) for w in (24, 27, 29, 30, 31, 32, 34)]
    assert minutes == sorted(minutes, reverse=True)
    assert minutes[0] == 60 and minutes[-1] == 0
    assert set(minutes) <= {0, 15, 30, 45, 60}


def test_schedule_keeps_hourly_average_within_limit():
    for wbgt in (27.5, 29.0, 30.5, 31.5):
        for watts in (300, 415, 520):
            work = limits.work_minutes(wbgt, watts, True)
            if work == 0:
                continue
            twa = (work * watts + (60 - work) * limits.REST_WATTS) / 60
            assert limits.wbgt_limit_c(twa, True) >= wbgt - 1e-9


def test_cooler_rest_area_earns_more_work_time():
    same_heat = limits.work_minutes(30.0, 415, True)
    shade = limits.work_minutes(30.0, 415, True, rest_wbgt_effective_c=27.0)
    cabin = limits.work_minutes(30.0, 415, True, rest_wbgt_effective_c=22.0)
    assert same_heat <= shade <= cabin
    assert cabin > same_heat


def test_shaded_schedule_keeps_hourly_averages_within_limit():
    for wbgt, rest in ((30.0, 27.0), (32.0, 28.0), (34.0, 29.0)):
        for watts in (180, 300, 415):
            work = limits.work_minutes(wbgt, watts, True, rest)
            if work == 0:
                continue
            share = work / 60
            twa_watts = share * watts + (1 - share) * limits.REST_WATTS
            twa_wbgt = share * wbgt + (1 - share) * rest
            assert twa_wbgt <= limits.wbgt_limit_c(twa_watts, True) + 1e-9


def test_unacclimatized_workers_get_less_work_time():
    assert limits.work_minutes(28.0, 415, False) < limits.work_minutes(28.0, 415, True)


def test_no_work_when_resting_exceeds_limit():
    assert limits.work_minutes(limits.wbgt_limit_c(limits.REST_WATTS, True) + 0.1, 180, True) == 0


@pytest.mark.parametrize(
    "wbgt, work_min, expected",
    [(25.0, 60, Level.GREEN), (28.5, 60, Level.YELLOW), (30.0, 45, Level.ORANGE),
     (30.0, 30, Level.ORANGE), (31.0, 15, Level.RED), (35.0, 0, Level.RED)],
)
def test_classify(wbgt, work_min, expected):
    assert limits.classify(wbgt, 30.0, work_min) is expected


def test_raise_level_stops_at_red():
    assert limits.raise_level(Level.GREEN) is Level.YELLOW
    assert limits.raise_level(Level.ORANGE, 3) is Level.RED


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_assess_with_given_wbgt():
    body = {"weather": WEATHER, "metabolicWatts": 415, "acclimatized": True, "wbgtC": 28.5}
    res = client.post("/assess", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["limitC"] == pytest.approx(26.59, abs=0.01)
    assert data["workMin"] + data["restMin"] == 60
    assert data["workMin"] == 30
    assert data["level"] == "ORANGE"
    # A supplied WBGT has no weather-based shade estimate: rest is in the same heat.
    assert data["restWbgtC"] == 28.5
    assert data["workMinRestInSun"] == 30


def test_measured_rest_area_wbgt_is_used():
    body = {"weather": WEATHER, "metabolicWatts": 415, "wbgtC": 30.0, "restWbgtC": 22.0}
    data = client.post("/assess", json=body).json()
    assert data["restWbgtC"] == 22.0
    assert data["workMin"] > data["workMinRestInSun"]


def test_clothing_adjustment_raises_effective_wbgt():
    body = {"weather": WEATHER, "metabolicWatts": 300, "wbgtC": 25.0, "clothingAdjC": 3.0}
    assert client.post("/assess", json=body).json()["wbgtEffectiveC"] == 28.0
