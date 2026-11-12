from datetime import datetime, timezone

import joblib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sklearn.ensemble import HistGradientBoostingRegressor

from app.forecast import service
from app.forecast.features import FEATURES, feature_row
from app.main import app

client = TestClient(app)

HOUR = {
    "weather": {"validAt": "2026-07-15T08:00:00Z", "latitude": 24.35, "longitude": 54.5, "tempC": 42.0,
                "humidityPct": 30.0, "windMs": 3.0, "radiationWm2": 850.0, "directRadiationWm2": 600.0},
    "prevDayWbgtC": 33.5,
    "prevDayErrorC": -0.6,
}


def constant_model(value: float):
    X = np.zeros((60, len(FEATURES)))
    return HistGradientBoostingRegressor(max_iter=5, min_samples_leaf=5).fit(X, np.full(60, value))


@pytest.fixture
def model_file(tmp_path, monkeypatch):
    def install(best: float, plan: float, features=FEATURES):
        path = tmp_path / "forecast_v1.joblib"
        joblib.dump({"best": constant_model(best), "plan": constant_model(plan), "features": features,
                     "meta": {"version": "forecast_test"}}, path)
        monkeypatch.setattr(service, "MODEL_PATH", path)
        service.load_model.cache_clear()
    yield install
    service.load_model.cache_clear()


def test_feature_row_matches_the_feature_list():
    row = feature_row(valid_at=datetime(2026, 7, 15, 6, tzinfo=timezone.utc), latitude=24.35, longitude=54.5,
                      fc_wbgt=33.0, fc_temp=42.0, fc_humidity=30.0, fc_wind=3.0, fc_radiation=850.0,
                      fc_direct=None, prev_day_wbgt=None, prev_day_error=None)
    assert len(row) == len(FEATURES)
    assert row[FEATURES.index("hour_sin")] == pytest.approx(1.0)
    assert np.isnan(row[FEATURES.index("fc_direct")])
    assert np.isnan(row[FEATURES.index("prev_day_wbgt")])


def test_forecast_reports_missing_model(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "MODEL_PATH", tmp_path / "missing.joblib")
    service.load_model.cache_clear()
    res = client.post("/forecast", json={"hours": [HOUR]})
    service.load_model.cache_clear()
    assert res.status_code == 503
    assert "train_forecast" in res.json()["detail"]


def test_forecast_applies_both_corrections(model_file):
    model_file(best=-0.5, plan=0.8)
    data = client.post("/forecast", json={"hours": [HOUR]}).json()
    hour = data["hours"][0]
    assert data["modelVersion"] == "forecast_test"
    assert hour["wbgtBestC"] == pytest.approx(hour["wbgtRawC"] - 0.5, abs=0.02)
    assert hour["wbgtPlanC"] == pytest.approx(hour["wbgtRawC"] + 0.8, abs=0.02)


def test_plan_value_is_never_below_the_raw_forecast(model_file):
    model_file(best=-1.0, plan=-0.7)
    hour = client.post("/forecast", json={"hours": [HOUR]}).json()["hours"][0]
    assert hour["wbgtPlanC"] == hour["wbgtRawC"]


def test_forecast_works_without_yesterdays_values(model_file):
    model_file(best=0.0, plan=0.0)
    res = client.post("/forecast", json={"hours": [{"weather": HOUR["weather"]}]})
    assert res.status_code == 200


def test_model_with_other_features_is_refused(model_file):
    model_file(best=0.0, plan=0.0, features=["something_else"])
    assert client.post("/forecast", json={"hours": [HOUR]}).status_code == 503


def test_adaptive_gate_needs_enough_recent_bias():
    from app.forecast import adaptive

    rng = np.random.default_rng(0)
    noise = rng.normal(0, 1.0, adaptive.MIN_HOURS)
    assert adaptive.gate_is_open(noise - 0.9) is True        # forecast runs 0.9 C hot
    assert adaptive.gate_is_open(noise + 0.05) is False      # no clear bias
    assert adaptive.gate_is_open(np.full(100, -2.0)) is False  # too little history


def test_adaptive_correction_is_zero_when_the_gate_is_closed():
    from app.forecast import adaptive

    X = np.zeros((adaptive.MIN_HOURS, len(FEATURES)))
    delta, active = adaptive.correction(X, np.zeros(adaptive.MIN_HOURS), X[:5])
    assert active is False
    assert np.all(delta == 0)
    delta, active = adaptive.correction(X, np.full(adaptive.MIN_HOURS, -0.9), X[:5])
    assert active is True
    assert np.allclose(delta, -0.9, atol=0.05)
