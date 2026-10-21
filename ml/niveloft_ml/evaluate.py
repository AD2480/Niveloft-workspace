"""Training on earlier work and testing on later work, and deciding whether anything is better.

The test is a replay: the models are trained on the tasks approved up to a cut-off date, as if
they'd been built that day, and then forecast the tasks that started after it. Tasks still in
flight at the cut-off are left out of both, so nothing a model sees came from its own future.

A model is recommended only when it beats Niveloft's current forecast on that later work by a
margin, and does so reliably (in nearly all bootstrap resamples of the test tasks). Otherwise
the answer is to keep the current forecast, which is a result too.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from . import features as feat
from . import history as hist
from .models import BASELINES, Candidate, baseline

#: The 80% range Niveloft shows (p10 to p90) is ± this many spreads around its median.
Z80 = 1.2815515655446004


@dataclass
class Settings:
    test_share: float = 0.25
    min_train: int = 60
    min_test: int = 30
    #: The least improvement worth switching for, as a share of Niveloft's typical miss.
    min_gain: float = 0.05
    #: How often (across bootstrap resamples) the model must come out ahead.
    min_confidence: float = 0.95
    bootstrap: int = 2000
    seed: int = 7


@dataclass
class Scores:
    name: str
    description: str
    median_error_days: float
    mean_error_days: float
    #: The typical miss as a factor: 1.30 means "off by 30% either way" on a typical task.
    typical_miss: float
    within_25_percent: float
    #: Against Niveloft's forecast (None for itself): share of its typical miss removed, and how reliably.
    gain: float | None = None
    gain_range: tuple[float, float] | None = None
    ahead_in: float | None = None


@dataclass
class Outcome:
    data: dict
    scores: list[Scores]
    decision: dict
    niveloft_range_coverage: float | None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def time_split(done: pd.DataFrame, test_share: float) -> tuple[pd.Index, pd.Index, pd.Timestamp | None]:
    """Train on what was approved up to a cut-off; test on what started after it."""
    if len(done) < 2:
        return done.index, done.index[:0], None
    want = max(1, int(round(len(done) * test_share)))
    ready = np.sort(done["ready_at"].to_numpy())
    cut = None
    for at in np.sort(done["approved_at"].to_numpy()):
        started_after = len(ready) - np.searchsorted(ready, at, side="right")
        cut = at
        if started_after <= want:
            break
    cut_ts = pd.Timestamp(cut)
    train = done.index[done["approved_at"] <= cut_ts]
    test = done.index[done["ready_at"] > cut_ts]
    return train, test, cut_ts


def _scores(name: str, description: str, pred_log: np.ndarray, actual: np.ndarray) -> Scores:
    pred = np.exp(pred_log)
    err = np.abs(pred - actual)
    log_err = np.abs(np.log(pred / actual))
    return Scores(
        name=name,
        description=description,
        median_error_days=float(np.median(err)),
        mean_error_days=float(np.mean(err)),
        typical_miss=float(math.exp(np.mean(log_err))),
        within_25_percent=float(np.mean(log_err <= math.log(1.25))),
    )


def compare(base_log_err: np.ndarray, cand_log_err: np.ndarray, rounds: int, seed: int) -> tuple[float, tuple[float, float], float]:
    """How much of the baseline's typical miss the candidate removes, a 90% range for that, and
    the share of bootstrap resamples in which the candidate is ahead."""
    rng = np.random.default_rng(seed)
    n = len(base_log_err)
    idx = rng.integers(0, n, size=(rounds, n))
    b = base_log_err[idx].mean(axis=1)
    c = cand_log_err[idx].mean(axis=1)
    gains = 1 - c / np.where(b > 0, b, np.nan)
    point = 1 - cand_log_err.mean() / base_log_err.mean() if base_log_err.mean() > 0 else 0.0
    lo, hi = np.nanpercentile(gains, [5, 95])
    return float(point), (float(lo), float(hi)), float(np.mean(c < b))


def run(h: hist.History, models: list[Candidate], s: Settings) -> tuple[Outcome, dict | None]:
    """Trains every candidate on the earlier work and scores everything on the later work.
    Returns the outcome and, when one is recommended, the fitted model and what it needs."""
    all_tasks = h.tasks
    done = hist.finished(all_tasks)
    notes: list[str] = []
    data = {
        "files": h.files,
        "projects": h.projects,
        "synthetic": h.synthetic,
        "tasks": int(len(all_tasks)),
        "finished_with_start": int(len(done)),
        "people": int(all_tasks["person"].dropna().nunique()),
    }
    if len(done) == 0:
        decision = {"recommend": None, "verdict": "no-history", "why": "No approved task in these files has a start date, so there’s nothing to learn from yet."}
        return Outcome(data, [], decision, None, notes), None

    known = feat.known_at_start(all_tasks, done, done)
    X = feat.build(done, known)
    y = np.log(done["work_days"].to_numpy(dtype=float))
    train, test, cut = time_split(done, s.test_share)
    data.update(
        train=int(len(train)),
        test=int(len(test)),
        cutoff=None if cut is None else cut.isoformat(),
        in_flight_at_cutoff=int(len(done) - len(train) - len(test)),
        estimated_share=float(done["estimate_days"].gt(0).mean()),
    )
    if len(train) < s.min_train or len(test) < s.min_test:
        decision = {
            "recommend": None,
            "verdict": "not-enough-history",
            "why": (
                f"There are {len(train)} finished tasks to learn from and {len(test)} later ones to test on; a fair test needs at least "
                f"{s.min_train} and {s.min_test}. Keep using Niveloft’s forecast, and run this again when more work is approved."
            ),
        }
        scores = []
        if len(test):
            actual = done.loc[test, "work_days"].to_numpy(dtype=float)
            for name, (description, _) in BASELINES.items():
                scores.append(_scores(name, description, baseline(name, X.loc[test]), actual))
            notes.append("With this little history the numbers below are only indicative.")
        return Outcome(data, scores, decision, _coverage(X.loc[test], known.loc[test], done.loc[test]) if len(test) else None, notes), None

    actual = done.loc[test, "work_days"].to_numpy(dtype=float)
    scores = [_scores(name, description, baseline(name, X.loc[test]), actual) for name, (description, _) in BASELINES.items()]
    base_err = np.abs(baseline("niveloft", X.loc[test]) - np.log(actual))
    fitted = {}
    for c in models:
        try:
            m = c.make()
            m.fit(X.loc[train], y[np.isin(done.index, train)])
            pred = np.asarray(m.predict(X.loc[test]), dtype=float)
        except Exception as e:  # a model that can't be fitted is reported, not fatal
            notes.append(f"{c.name} couldn’t be trained: {type(e).__name__}: {e}")
            continue
        sc = _scores(c.name, c.description, pred, actual)
        sc.gain, sc.gain_range, sc.ahead_in = compare(base_err, np.abs(pred - np.log(actual)), s.bootstrap, s.seed)
        scores.append(sc)
        fitted[c.name] = m

    plan, niveloft = scores[0], scores[1]
    plan_vs = compare(np.abs(baseline("plan", X.loc[test]) - np.log(actual)), base_err, s.bootstrap, s.seed)
    data["niveloft_vs_plan"] = {"gain": plan_vs[0], "gain_range": plan_vs[1], "ahead_in": plan_vs[2]}

    tried = [sc for sc in scores if sc.name in fitted]
    best = min(tried, key=lambda sc: sc.typical_miss) if tried else None
    if best and best.gain is not None and best.gain >= s.min_gain and (best.ahead_in or 0) >= s.min_confidence:
        decision = {
            "recommend": best.name,
            "verdict": "model-is-better",
            "why": (
                f"{best.description} missed by ×{best.typical_miss:.2f} on a typical later task, against ×{niveloft.typical_miss:.2f} for Niveloft’s "
                f"forecast: {best.gain:.0%} of its typical miss removed (90% range {best.gain_range[0]:.0%} to {best.gain_range[1]:.0%}), ahead in "
                f"{best.ahead_in:.0%} of resamples."
            ),
        }
        # Refit on everything for use from now on (the test above is what vouches for it).
        final = next(c for c in models if c.name == best.name).make()
        final.fit(X, y)
        fitted = {
            "model": final,
            "features": list(X.columns),
            "name": best.name,
            "description": best.description,
            # The last approval it learned from: work that could start after this is new to it.
            "through": pd.Timestamp(done["approved_at"].max()).isoformat(),
        }
        return Outcome(data, scores, decision, _coverage(X.loc[test], known.loc[test], done.loc[test]), notes), fitted
    if best is None:
        why = "No model could be trained."
    elif best.gain is None or best.gain < s.min_gain:
        why = (
            f"The best model ({best.name}) missed by ×{best.typical_miss:.2f} on a typical later task, against ×{niveloft.typical_miss:.2f} for Niveloft’s "
            f"forecast: not the {s.min_gain:.0%} improvement worth switching for."
        )
    else:
        why = (
            f"The best model ({best.name}) looked {best.gain:.0%} better, but only in {best.ahead_in:.0%} of resamples (it needs {s.min_confidence:.0%}): "
            "that could be luck in which tasks were tested."
        )
    decision = {"recommend": None, "verdict": "keep-niveloft", "why": why + " Keep Niveloft’s forecast."}
    return Outcome(data, scores, decision, _coverage(X.loc[test], known.loc[test], done.loc[test]), notes), None


def _coverage(X: pd.DataFrame, known: pd.DataFrame, done: pd.DataFrame) -> float | None:
    """How often the actual time fell inside the 80% range Niveloft would have shown."""
    if not len(X):
        return None
    mid = X["log_pace_forecast"].to_numpy()
    spread = known["pace_sigma"].to_numpy(dtype=float)
    actual = np.log(done["work_days"].to_numpy(dtype=float))
    inside = (actual >= mid - Z80 * spread) & (actual <= mid + Z80 * spread)
    return float(inside.mean())
