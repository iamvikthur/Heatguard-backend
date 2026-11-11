from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.rules.wbgt import cos_solar_zenith, direct_fraction, estimate_shade_wbgt_c, estimate_wbgt_c
from app.schemas import Weather

client = TestClient(app)


def weather(**overrides) -> Weather:
    base = dict(
        valid_at=datetime(2025, 7, 15, 8, 0, tzinfo=timezone.utc),  # 12:00 Gulf time
        latitude=24.35,
        longitude=54.5,
        temp_c=42.0,
        humidity_pct=30.0,
        wind_ms=3.0,
        radiation_wm2=850.0,
        direct_radiation_wm2=600.0,
    )
    base.update(overrides)
    return Weather(**base)


def test_sun_is_high_at_gulf_midday_and_down_at_night():
    assert cos_solar_zenith(24.35, 54.5, datetime(2025, 7, 15, 8, 30, tzinfo=timezone.utc)) > 0.95
    assert cos_solar_zenith(24.35, 54.5, datetime(2025, 7, 15, 20, 0, tzinfo=timezone.utc)) == 0.0


def test_wbgt_is_in_a_plausible_range_for_gulf_summer_midday():
    assert 30.0 < estimate_wbgt_c(weather()) < 40.0


def test_sun_raises_wbgt():
    sunny = estimate_wbgt_c(weather())
    night = estimate_wbgt_c(
        weather(valid_at=datetime(2025, 7, 15, 20, 0, tzinfo=timezone.utc), radiation_wm2=0, direct_radiation_wm2=0)
    )
    assert sunny > night + 2


def test_humidity_raises_wbgt():
    assert estimate_wbgt_c(weather(humidity_pct=60)) > estimate_wbgt_c(weather(humidity_pct=20)) + 2


def test_wind_lowers_wbgt_in_the_sun():
    assert estimate_wbgt_c(weather(wind_ms=8)) < estimate_wbgt_c(weather(wind_ms=1))


def test_night_wbgt_sits_between_wet_bulb_and_air_temperature():
    w = weather(valid_at=datetime(2025, 7, 15, 20, 0, tzinfo=timezone.utc), temp_c=34, humidity_pct=54,
                radiation_wm2=0, direct_radiation_wm2=0)
    assert 24.0 < estimate_wbgt_c(w) < 34.0


def test_shade_is_cooler_than_sun_by_day_and_equal_at_night():
    assert estimate_shade_wbgt_c(weather()) < estimate_wbgt_c(weather()) - 1
    night = weather(valid_at=datetime(2025, 7, 15, 20, 0, tzinfo=timezone.utc), radiation_wm2=0, direct_radiation_wm2=0)
    assert estimate_shade_wbgt_c(night) == pytest.approx(estimate_wbgt_c(night))


def test_direct_fraction_defaults_and_bounds():
    assert direct_fraction(weather(direct_radiation_wm2=None)) == 0.65
    assert direct_fraction(weather(radiation_wm2=0, direct_radiation_wm2=0)) == 0.0
    assert direct_fraction(weather(direct_radiation_wm2=900)) == 1.0


def test_regression_value_for_reference_case():
    # Pinned from thermofeel 2.3.0 so a library or input-handling change is noticed.
    assert estimate_wbgt_c(weather()) == pytest.approx(REFERENCE_WBGT, abs=0.3)


def test_assess_from_weather_alone():
    body = {
        "weather": {"validAt": "2025-07-15T08:00:00Z", "latitude": 24.35, "longitude": 54.5, "tempC": 42.0,
                    "humidityPct": 30.0, "windMs": 3.0, "radiationWm2": 850.0, "directRadiationWm2": 600.0},
        "metabolicWatts": 415,
    }
    res = client.post("/assess", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["restWbgtC"] < data["wbgtC"]
    assert data["workMin"] >= data["workMinRestInSun"]


def test_rest_in_sun_can_be_requested():
    body = {
        "weather": {"validAt": "2025-07-15T08:00:00Z", "latitude": 24.35, "longitude": 54.5, "tempC": 42.0,
                    "humidityPct": 30.0, "windMs": 3.0, "radiationWm2": 850.0, "directRadiationWm2": 600.0},
        "metabolicWatts": 300,
        "restInShade": False,
    }
    data = client.post("/assess", json=body).json()
    assert data["restWbgtC"] == data["wbgtC"]
    assert data["workMin"] == data["workMinRestInSun"]


REFERENCE_WBGT = 34.91
