from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
DAY = datetime(2025, 7, 15, tzinfo=timezone.utc)


def weather(when: datetime, temp: float) -> dict:
    daylight = 2 <= when.hour <= 13
    return {
        "validAt": when.isoformat(),
        "latitude": 24.35,
        "longitude": 54.5,
        "tempC": temp,
        "humidityPct": 45.0,
        "windMs": 3.0,
        "radiationWm2": 700.0 if daylight else 0.0,
        "directRadiationWm2": 450.0 if daylight else 0.0,
    }


def history(days: int, forecast_runs_hot_by: float) -> list[dict]:
    hours = []
    for d in range(days, 0, -1):
        for h in range(24):
            when = DAY - timedelta(days=d) + timedelta(hours=h)
            observed = 34.0 + 5.0 * (h % 12) / 12
            hours.append({"forecast": weather(when, observed + forecast_runs_hot_by), "observed": weather(when, observed)})
    return hours


TARGET = [weather(DAY + timedelta(hours=h), 40.0) for h in range(2, 10)]


def test_plan_corrects_a_forecast_that_has_been_running_hot():
    data = client.post("/plan", json={"history": history(40, 2.0), "target": TARGET}).json()
    assert data["active"] is True
    assert data["windowBiasC"] < -0.4
    assert len(data["hours"]) == 8
    assert all(h["wbgtPlanC"] < h["wbgtRawC"] for h in data["hours"])


def test_plan_stands_down_when_the_forecast_has_been_right():
    data = client.post("/plan", json={"history": history(40, 0.0), "target": TARGET}).json()
    assert data["active"] is False
    assert all(h["wbgtPlanC"] == h["wbgtRawC"] for h in data["hours"])


def test_plan_stands_down_without_enough_history():
    data = client.post("/plan", json={"history": history(5, 2.0), "target": TARGET}).json()
    assert data["active"] is False
    assert data["historyHoursUsed"] == 24 * 4  # the day before the planned day is never used


def test_plan_works_with_no_history_at_all():
    data = client.post("/plan", json={"history": [], "target": TARGET}).json()
    assert data["active"] is False
    assert data["windowBiasC"] is None


def test_plan_ignores_history_older_than_the_window():
    old = client.post("/plan", json={"history": history(60, 2.0), "target": TARGET}).json()
    assert old["historyHoursUsed"] == 24 * 45
