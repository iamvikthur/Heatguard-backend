"""Adaptive forecast correction.

The fixed model (training/train_forecast.py) failed its 2026 test because the
forecast's bias changed between years. This version never looks further back
than a recent window, and it switches itself off when the recent forecast shows
no clear bias, in which case the raw forecast is used unchanged.
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

WINDOW_DAYS = 45        # how far back the model may learn from
RETRAIN_DAYS = 7        # how often it is refitted
QUANTILE = 0.8          # aims high on purpose: this is a planning value
GATE_C = 0.4            # mean forecast error (C) in the window needed to switch on
MIN_HOURS = 24 * 2 * 14 # pooled evaluation: at least two weeks of hours from two sites
MIN_HOURS_ONE_SITE = 24 * 14  # serving: at least two weeks of hours from the site itself

PARAMS = dict(max_iter=120, learning_rate=0.06, max_leaf_nodes=8, min_samples_leaf=30,
              l2_regularization=1.0, random_state=0)


def gate_is_open(window_residuals: np.ndarray, threshold_c: float = GATE_C, min_hours: int = MIN_HOURS) -> bool:
    """True when the recent forecast is biased enough to be worth correcting.

    window_residuals: observed minus forecast WBGT for every hour in the window.
    """
    if len(window_residuals) < min_hours:
        return False
    return bool(abs(float(np.mean(window_residuals))) >= threshold_c)


def fit_window(X: np.ndarray, residuals: np.ndarray, quantile: float = QUANTILE) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(loss="quantile", quantile=quantile, **PARAMS).fit(X, residuals)


def correction(
    X_window: np.ndarray, residuals_window: np.ndarray, X_target: np.ndarray, min_hours: int = MIN_HOURS
) -> tuple[np.ndarray, bool]:
    """Correction to add to the raw forecast WBGT for the target hours.

    Returns zeros and False when the gate is closed.
    """
    if not gate_is_open(residuals_window, min_hours=min_hours):
        return np.zeros(len(X_target)), False
    return fit_window(X_window, residuals_window).predict(X_target), True
