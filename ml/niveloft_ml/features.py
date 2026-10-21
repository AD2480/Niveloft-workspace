"""What was known when a task could start: the only things a forecast may learn from.

Every feature here is computed from the task itself (its estimate, priority, size of its
description and criteria, what it waits on) and from work approved *before* it could start
(each person's pace so far, the project's typical estimate). Nothing from the task's own outcome
or from later tasks leaks in: that's what makes the comparison with Niveloft's forecast fair.
"""

from __future__ import annotations

import bisect
import math
from collections import defaultdict

import numpy as np
import pandas as pd

from .history import days_between

#: Pull each person's pace towards the project's until they have a few finished tasks (as the app does).
SHRINK = 2.0
#: Pace ratios beyond these are treated as these (the app clips the same way).
RATIO_RANGE = (0.2, 5.0)
#: The estimate assumed for unestimated work when the project has none yet (the app's fallback).
DEFAULT_TYPICAL = 2.0
#: The app's spread when it has too little history, and the narrowest it ever allows.
DEFAULT_SIGMA = 0.35
MIN_SIGMA = 0.2
PRIORITY_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "URGENT": 4}

#: The model's inputs, in order.
FEATURES = [
    "estimate_days",
    "has_estimate",
    "log_base",
    "priority_rank",
    "waits_on",
    "holds_up",
    "criteria",
    "checklist",
    "log_description",
    "queue_days",
    "due_slack_days",
    "has_due",
    "start_weekday",
    "person_n",
    "person_pace",
    "log_person_median_work",
    "project_n",
    "project_pace",
    "log_pace_forecast",
]


def _log_ratio(actual: float, estimate: float) -> float:
    lo, hi = RATIO_RANGE
    return math.log(min(hi, max(lo, actual / estimate)))


def known_at_start(all_tasks: pd.DataFrame, finished: pd.DataFrame, rows: pd.DataFrame) -> pd.DataFrame:
    """For each of ``rows`` (they need ``ready_at``), what the records showed at that moment.

    ``finished`` are the approved tasks with targets (see history.finished): their approvals are
    the events learned from. ``all_tasks`` gives every task's creation and estimate, for the
    project's typical estimate at the time.
    """
    approvals = finished.sort_values("approved_at", kind="stable")
    created = all_tasks[all_tasks["created_at"].notna()].sort_values("created_at", kind="stable")
    order = rows["ready_at"].sort_values(kind="stable").index

    per_person = defaultdict(lambda: [0, 0.0, 0.0])  # tasks with an estimate, sum and sum of squares of log pace
    person_work = defaultdict(list)  # sorted work days
    per_project = defaultdict(lambda: [0, 0.0, 0.0])
    project_estimates = defaultdict(list)  # sorted estimates of tasks created so far
    a_i = c_i = 0
    a_rows = list(approvals.itertuples(index=False))
    c_rows = list(created.itertuples(index=False))
    out = {}
    for idx, r in zip(order, rows.loc[order, ["ready_at", "project", "person"]].itertuples(index=False)):
        t = r.ready_at
        while a_i < len(a_rows) and a_rows[a_i].approved_at < t:
            a = a_rows[a_i]
            a_i += 1
            if a.person is not None and isinstance(a.person, str):
                bisect.insort(person_work[a.person], float(a.work_days))
            if a.estimate_days == a.estimate_days and a.estimate_days and a.estimate_days > 0:  # not NaN
                lr = _log_ratio(float(a.work_days), float(a.estimate_days))
                for acc in [per_project[a.project]] + ([per_person[a.person]] if isinstance(a.person, str) else []):
                    acc[0] += 1
                    acc[1] += lr
                    acc[2] += lr * lr
        while c_i < len(c_rows) and c_rows[c_i].created_at < t:
            c = c_rows[c_i]
            c_i += 1
            if c.estimate_days == c.estimate_days and c.estimate_days and c.estimate_days > 0:
                bisect.insort(project_estimates[c.project], float(c.estimate_days))
        pn, ps, pss = per_project[r.project]
        project_pace = ps / pn if pn else 0.0
        project_var = (pss - pn * project_pace**2) / (pn - 1) if pn > 1 else DEFAULT_SIGMA**2
        person = r.person if isinstance(r.person, str) else None
        n, s, ss = per_person[person] if person else (0, 0.0, 0.0)
        work = person_work[person] if person else []
        ests = project_estimates[r.project]
        # The app's pace: the person's mean log(actual ÷ estimate), pulled towards the project's,
        # and its spread, pulled the same way (learnPaceSpread in progressForecast.ts).
        if person and n:
            mu = (s + SHRINK * project_pace) / (n + SHRINK)
            spread = math.sqrt(max(0.0, (ss - 2 * mu * s + n * mu * mu) + SHRINK * project_var) / (n + SHRINK))
        else:
            mu, spread = project_pace, math.sqrt(max(project_var, 0.0))
        out[idx] = {
            "person_n": n,
            "person_pace": mu,
            "pace_sigma": max(MIN_SIGMA, spread),
            "person_median_work": float(np.median(work)) if work else np.nan,
            "project_n": pn,
            "project_pace": project_pace,
            "typical_estimate": float(np.median(ests)) if ests else DEFAULT_TYPICAL,
        }
    return pd.DataFrame.from_dict(out, orient="index").reindex(rows.index)


def build(rows: pd.DataFrame, known: pd.DataFrame) -> pd.DataFrame:
    """The feature table for ``rows`` (with ``ready_at``), given what was known at their start."""
    f = pd.DataFrame(index=rows.index)
    est = rows["estimate_days"].where(rows["estimate_days"] > 0)
    f["estimate_days"] = est
    f["has_estimate"] = est.notna().astype(int)
    base = est.fillna(known["typical_estimate"])
    f["log_base"] = np.log(base)
    f["priority_rank"] = rows["priority"].map(PRIORITY_RANK).fillna(2).astype(int)
    for c in ["waits_on", "holds_up", "criteria", "checklist"]:
        f[c] = rows[c].astype(float)
    f["log_description"] = np.log1p(rows["description_chars"].astype(float))
    f["queue_days"] = days_between(rows["created_at"], rows["ready_at"]).clip(lower=0)
    ready_day = rows["ready_at"].dt.tz_convert("UTC").dt.tz_localize(None).dt.normalize()
    f["due_slack_days"] = (rows["due_date"] - ready_day).dt.days.astype(float)
    f["has_due"] = rows["due_date"].notna().astype(int)
    f["start_weekday"] = rows["ready_at"].dt.weekday.astype(float)
    f["person_n"] = known["person_n"].astype(float)
    f["person_pace"] = known["person_pace"].astype(float)
    f["log_person_median_work"] = np.log(known["person_median_work"].astype(float))
    f["project_n"] = known["project_n"].astype(float)
    f["project_pace"] = known["project_pace"].astype(float)
    # Niveloft's own forecast (its median), as one input among others.
    f["log_pace_forecast"] = f["log_base"] + f["person_pace"]
    return f[FEATURES]
