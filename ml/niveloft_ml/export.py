"""A trained model in a portable form (JSON), for Niveloft's server to run beside its forecast.

The server has no Python, so a winning model goes to it as numbers: the feature list in order,
how missing values are filled, and the model itself. Every built-in candidate exports:

- ridge: a linear formula (median filling, missing-value flags, scaling, coefficients);
- gbm: scikit-learn's histogram gradient boosting, as trees of thresholds;
- correction: Niveloft's forecast plus such trees;
- forest: a random forest, as trees of thresholds (after median filling and flags).

XGBoost and AutoGluon don't export; the report says so. ``predict`` here is the reference the
server's Java must agree with (the tests check both against scikit-learn's own predictions).
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

SCHEMA = "niveloft-work-days/1"
SOURCE = "niveloft-task-history-v1"
TARGET = "log working days from when a task could proceed (started, and everything it waited on approved) to its final submission for review"


class NotPortable(ValueError):
    """A model this format can't hold (the report says so; the joblib file is still written)."""


def _num(x: float) -> float | None:
    """JSON has no NaN: missing numbers are null."""
    x = float(x)
    return None if math.isnan(x) else x


#: JSON has no infinity. A split at +inf (the trees send every number one way and only missing
#: values the other) is written as the largest double, which compares the same for every finite value.
BIG = 1.7976931348623157e308


def _threshold(v: float) -> float:
    v = float(v)
    if math.isnan(v):
        return 0.0  # a leaf's: never compared
    if math.isinf(v):
        return BIG if v > 0 else -BIG
    return v


def _linear_inputs(imputer) -> tuple[list[float | None], list[int]]:
    """What a SimpleImputer(median, add_indicator=True) does: each feature's fill (null when the
    feature was empty in training and is dropped), and the features that get a missing-value flag."""
    if getattr(imputer, "strategy", None) != "median":
        raise NotPortable("only median filling is portable")
    fill = [_num(v) for v in imputer.statistics_]
    flags = [int(i) for i in imputer.indicator_.features_] if getattr(imputer, "indicator_", None) is not None else []
    return fill, flags


def _hgb_trees(model) -> dict:
    """scikit-learn's HistGradientBoostingRegressor as plain trees: a split sends x <= threshold left,
    and a missing value the way it learned; a leaf's value already includes the learning rate."""
    if getattr(model, "is_categorical_", None) is not None and np.any(model.is_categorical_):
        raise NotPortable("categorical splits aren't portable")
    if getattr(model, "loss", "squared_error") != "squared_error":
        raise NotPortable("only the squared-error loss is portable")
    trees = []
    for (predictor,) in model._predictors:
        n = predictor.nodes
        trees.append(
            {
                "feature": n["feature_idx"].astype(int).tolist(),
                "threshold": [_threshold(t) for t in n["num_threshold"]],
                "missing_left": n["missing_go_to_left"].astype(int).tolist(),
                "left": n["left"].astype(int).tolist(),
                "right": n["right"].astype(int).tolist(),
                "leaf": n["is_leaf"].astype(int).tolist(),
                "value": [float(v) for v in n["value"]],
            }
        )
    return {"baseline": float(np.ravel(model._baseline_prediction)[0]), "trees": trees}


def _forest_trees(forest) -> list[dict]:
    """A random forest's trees: x (as a 32-bit float, as scikit-learn compares) <= threshold goes left."""
    trees = []
    for est in forest.estimators_:
        t = est.tree_
        trees.append(
            {
                "feature": t.feature.astype(int).tolist(),
                "threshold": [_threshold(v) for v in t.threshold],
                "left": t.children_left.astype(int).tolist(),
                "right": t.children_right.astype(int).tolist(),
                "value": [float(v) for v in t.value[:, 0, 0]],
            }
        )
    return trees


def model_part(name: str, model) -> dict:
    """The model's own numbers, by kind."""
    from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import Ridge
    from sklearn.pipeline import Pipeline

    from .models import Correction

    if isinstance(model, Correction):
        return {"kind": "correction", "base_feature": "log_pace_forecast", **_hgb_trees(model.model_)}
    if isinstance(model, HistGradientBoostingRegressor):
        return {"kind": "gbm", **_hgb_trees(model)}
    if isinstance(model, Pipeline):
        steps = [s for _, s in model.steps]
        if len(steps) == 3 and isinstance(steps[2], Ridge):
            fill, flags = _linear_inputs(steps[0])
            scaler = steps[1]
            return {
                "kind": "linear",
                "fill": fill,
                "flags": flags,
                "mean": [float(v) for v in scaler.mean_],
                "scale": [float(v) for v in scaler.scale_],
                "coef": [float(v) for v in np.ravel(steps[2].coef_)],
                "intercept": float(np.ravel([steps[2].intercept_])[0]),
            }
        if len(steps) == 2 and isinstance(steps[1], RandomForestRegressor):
            fill, flags = _linear_inputs(steps[0])
            return {"kind": "forest", "fill": fill, "flags": flags, "trees": _forest_trees(steps[1])}
    raise NotPortable(f"{name} ({type(model).__name__}) isn’t one of the portable kinds (ridge, gbm, correction, forest)")


def document(name: str, description: str, model, features: list[str], data: dict, decision: dict, through: str | None) -> dict:
    """The whole file: what it predicts, from what, trained on what, and the model."""
    return {
        "schema": SCHEMA,
        "source": SOURCE,
        "target": TARGET,
        "name": name,
        "description": description,
        "features": list(features),
        "trained": {
            "tasks": int(data.get("finished_with_start", 0)),
            "projects": list(data.get("projects", [])),
            "people": int(data.get("people", 0)),
            "through": through,
            "synthetic": bool(data.get("synthetic", False)),
            "made": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "decision": decision,
        "model": model_part(name, model),
    }


# ---------------------------------------------------------------------- the reference evaluator


def _inputs(part: dict, X: np.ndarray) -> np.ndarray:
    """Median filling (dropping features that were empty in training) and the missing-value flags."""
    keep = [i for i, f in enumerate(part["fill"]) if f is not None]
    filled = X[:, keep].copy()
    for j, i in enumerate(keep):
        col = filled[:, j]
        col[np.isnan(col)] = part["fill"][i]
    flags = np.isnan(X[:, part["flags"]]).astype(float) if part["flags"] else np.empty((len(X), 0))
    return np.hstack([filled, flags])


def _walk_hgb(tree: dict, x: np.ndarray) -> float:
    i = 0
    while not tree["leaf"][i]:
        v = x[tree["feature"][i]]
        go_left = bool(tree["missing_left"][i]) if math.isnan(v) else v <= tree["threshold"][i]
        i = tree["left"][i] if go_left else tree["right"][i]
    return tree["value"][i]


def _walk_forest(tree: dict, x: np.ndarray) -> float:
    i = 0
    while tree["left"][i] != -1:
        v = float(np.float32(x[tree["feature"][i]]))
        i = tree["left"][i] if v <= tree["threshold"][i] else tree["right"][i]
    return tree["value"][i]


def predict(doc: dict, X: pd.DataFrame | np.ndarray) -> np.ndarray:
    """Log working days for each row of X (the features in ``doc['features']`` order)."""
    if isinstance(X, pd.DataFrame):
        X = X[doc["features"]].to_numpy(dtype=float)
    X = np.asarray(X, dtype=float)
    part = doc["model"]
    kind = part["kind"]
    if kind == "linear":
        z = (_inputs(part, X) - np.asarray(part["mean"])) / np.asarray(part["scale"])
        return part["intercept"] + z @ np.asarray(part["coef"])
    if kind in ("gbm", "correction"):
        out = np.array([part["baseline"] + sum(_walk_hgb(t, x) for t in part["trees"]) for x in X])
        if kind == "correction":
            out = out + X[:, doc["features"].index(part["base_feature"])]
        return out
    if kind == "forest":
        Z = _inputs(part, X)
        return np.array([np.mean([_walk_forest(t, z) for t in part["trees"]]) for z in Z])
    raise NotPortable(f"unknown kind {kind}")


def write(doc: dict, path: str | Path) -> str:
    """Writes the file; returns its SHA-256 (the server names the model by it)."""
    text = json.dumps(doc, separators=(",", ":"), allow_nan=False) + "\n"
    Path(path).write_text(text, encoding="utf-8")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
