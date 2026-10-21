"""The two baselines and the candidate models. Everything predicts log working days.

Baselines:
  plan      the estimate as written (or the project's typical estimate when there's none)
  niveloft  Niveloft's current forecast: the estimate times the person's learned pace

Candidates (scikit-learn, always available): ridge, forest, gbm, and correction (a small
gradient-boosted model of what Niveloft's forecast misses, added to it). XGBoost and AutoGluon
are used only when they're installed and asked for.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from typing import Callable

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .features import FEATURES

BASELINES = {
    "plan": ("The estimate as written", "log_base"),
    "niveloft": ("Niveloft’s current forecast (estimate × the person’s learned pace)", "log_pace_forecast"),
}


def baseline(name: str, X: pd.DataFrame) -> np.ndarray:
    return X[BASELINES[name][1]].to_numpy(dtype=float)


class Correction(BaseEstimator, RegressorMixin):
    """Niveloft's forecast plus a learned correction: what it tends to miss, given the features."""

    def __init__(self, random_state: int = 0):
        self.random_state = random_state

    def fit(self, X, y):
        X = pd.DataFrame(X, columns=FEATURES)
        self.model_ = HistGradientBoostingRegressor(
            max_iter=200, learning_rate=0.04, max_depth=3, min_samples_leaf=20, l2_regularization=2.0, random_state=self.random_state
        )
        self.model_.fit(X, np.asarray(y) - X["log_pace_forecast"].to_numpy())
        return self

    def predict(self, X):
        X = pd.DataFrame(X, columns=FEATURES)
        return X["log_pace_forecast"].to_numpy() + self.model_.predict(X)


class AutoGluonModel(BaseEstimator, RegressorMixin):
    """AutoGluon Tabular, time-limited (only when ``autogluon.tabular`` is installed)."""

    def __init__(self, time_limit: int = 120, path: str | None = None):
        self.time_limit = time_limit
        self.path = path

    def fit(self, X, y):
        from autogluon.tabular import TabularPredictor  # type: ignore[import-not-found]

        data = pd.DataFrame(X, columns=FEATURES).assign(log_work=np.asarray(y))
        self.predictor_ = TabularPredictor(label="log_work", problem_type="regression", eval_metric="mean_absolute_error", path=self.path, verbosity=0)
        self.predictor_.fit(data, time_limit=self.time_limit, presets="medium_quality")
        return self

    def predict(self, X):
        return self.predictor_.predict(pd.DataFrame(X, columns=FEATURES)).to_numpy()


@dataclass(frozen=True)
class Candidate:
    name: str
    description: str
    make: Callable[[], BaseEstimator]


def available(optional: str | None) -> bool:
    module = {"xgboost": "xgboost", "autogluon": "autogluon.tabular"}.get(optional or "", optional or "")
    try:
        return importlib.util.find_spec(module) is not None
    except ModuleNotFoundError:
        return False


def candidates(extra: list[str] | None = None, seed: int = 0) -> tuple[list[Candidate], list[str]]:
    """The models to try, and notes about any optional ones that couldn't be used."""
    out = [
        Candidate("ridge", "Linear regression on the features (ridge)", lambda: make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(), Ridge(alpha=1.0))),
        Candidate(
            "forest",
            "Random forest",
            lambda: make_pipeline(
                SimpleImputer(strategy="median", add_indicator=True), RandomForestRegressor(n_estimators=300, min_samples_leaf=3, random_state=seed, n_jobs=-1)
            ),
        ),
        Candidate(
            "gbm",
            "Gradient-boosted trees (scikit-learn)",
            lambda: HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=10, l2_regularization=1.0, random_state=seed),
        ),
        Candidate("correction", "Niveloft’s forecast plus a learned correction (gradient-boosted)", lambda: Correction(random_state=seed)),
    ]
    notes = []
    for name in extra or []:
        if not available(name):
            notes.append(f"{name} was asked for but isn’t installed, so it wasn’t tried (pip install {'autogluon.tabular' if name == 'autogluon' else name}).")
        elif name == "xgboost":
            from xgboost import XGBRegressor  # type: ignore[import-not-found]

            out.append(
                Candidate(
                    "xgboost",
                    "Gradient-boosted trees (XGBoost)",
                    lambda: XGBRegressor(n_estimators=400, max_depth=4, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8, random_state=seed),
                )
            )
        elif name == "autogluon":
            out.append(Candidate("autogluon", "AutoGluon Tabular (an ensemble it picks itself, 2 minutes)", lambda: AutoGluonModel()))
        else:
            notes.append(f"There’s no model called {name}; choose from xgboost, autogluon.")
    return out, notes
