"""Reading Niveloft's task-history files and working out what a forecast should predict.

A file comes from Project settings → Forecast training data (owners and managers), or
``GET /api/projects/{id}/export/task-history.csv``. Several projects' files can be read together.

The target is the one Niveloft's own forecast predicts (``workDays`` in
``frontend/src/lib/progressForecast.ts``): the working time from when a task could really proceed
(it had started, and everything it waited on was approved) to its final submission for review, or
to its approval when it never went to review. Waiting for the review is a separate quantity.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

#: Version 1 of the file, column by column (TaskHistoryExport.COLUMNS on the server).
COLUMNS = [
    "project",
    "task",
    "status",
    "priority",
    "estimate_days",
    "person",
    "created_at",
    "started_at",
    "blockers_approved_at",
    "last_review_at",
    "approved_at",
    "due_date",
    "waits_on",
    "holds_up",
    "criteria",
    "checklist",
    "description_chars",
    "submissions",
    "changes_requested",
]

INSTANTS = ["created_at", "started_at", "blockers_approved_at", "last_review_at", "approved_at"]
COUNTS = ["waits_on", "holds_up", "criteria", "checklist", "description_chars", "submissions", "changes_requested"]
#: Known only once the work is done: for analysis, never used to predict.
OUTCOMES = ["submissions", "changes_requested", "last_review_at", "approved_at"]

#: Calendar days → working days, as Niveloft's forecast counts them.
WORKING = 5 / 7
#: The shortest work time Niveloft's forecast records (a quarter of a working day).
MIN_WORK_DAYS = 0.25
SYNTHETIC_PROJECT = "SYN"


class HistoryError(ValueError):
    """A file that isn't a Niveloft task history (or not this version of it)."""


@dataclass(frozen=True)
class History:
    tasks: pd.DataFrame
    files: list[str]

    @property
    def synthetic(self) -> bool:
        return bool(len(self.tasks)) and set(self.tasks["project"].unique()) == {SYNTHETIC_PROJECT}

    @property
    def projects(self) -> list[str]:
        return sorted(self.tasks["project"].unique().tolist())


def read(paths: Iterable[str | Path]) -> History:
    """Reads one or more task-history files into one table, with dates as UTC timestamps."""
    frames, names = [], []
    for p in paths:
        path = Path(p)
        try:
            df = pd.read_csv(path, dtype=str, keep_default_na=False)
        except (OSError, pd.errors.ParserError) as e:
            raise HistoryError(f"{path}: couldn't read it as CSV ({e}).") from e
        missing = [c for c in COLUMNS if c not in df.columns]
        if missing:
            raise HistoryError(
                f"{path}: not a Niveloft task history (version 1): missing {', '.join(missing)}. "
                "Download it from Project settings → Forecast training data."
            )
        frames.append(df[COLUMNS])
        names.append(str(path))
    if not frames:
        raise HistoryError("No files given.")
    return History(tidy(pd.concat(frames, ignore_index=True)), names)


def _blank(s: pd.Series) -> pd.Series:
    """Empty cells as missing values."""
    s = s.astype(str).str.strip()
    return s.where(s != "")


def tidy(df: pd.DataFrame) -> pd.DataFrame:
    """Types for every column: timestamps (UTC), numbers, and empty cells as missing."""
    out = df.copy()
    for c in INSTANTS:
        out[c] = pd.to_datetime(_blank(out[c]), utc=True, errors="coerce", format="ISO8601")
    out["due_date"] = pd.to_datetime(_blank(out["due_date"]), errors="coerce", format="ISO8601")
    out["estimate_days"] = pd.to_numeric(_blank(out["estimate_days"]), errors="coerce")
    for c in COUNTS:
        out[c] = pd.to_numeric(_blank(out[c]), errors="coerce").fillna(0).astype(int)
    person = _blank(out["person"])
    # The same pseudonym in two projects' files isn't the same person: keep them apart.
    out["person"] = (out["project"].astype(str) + ":" + person).where(person.notna())
    out["key"] = out["task"]
    return out


def days_between(a: pd.Series, b: pd.Series) -> pd.Series:
    return (b - a).dt.total_seconds() / 86400.0


def with_targets(df: pd.DataFrame) -> pd.DataFrame:
    """Adds ``ready_at`` (when it could proceed), ``work_days`` (the forecast's target),
    ``review_wait_days`` and ``late`` (approved after its due date), for finished tasks."""
    out = df.copy()
    ready = out["started_at"]
    blocked_later = out["blockers_approved_at"].notna() & (out["blockers_approved_at"] > out["started_at"])
    out["ready_at"] = ready.where(~blocked_later, out["blockers_approved_at"])
    review_counts = out["last_review_at"].notna() & (out["last_review_at"] >= out["ready_at"]) & (out["last_review_at"] <= out["approved_at"])
    end = out["approved_at"].where(~review_counts, out["last_review_at"])
    out["work_days"] = (days_between(out["ready_at"], end) * WORKING).clip(lower=MIN_WORK_DAYS)
    out["review_wait_days"] = days_between(out["last_review_at"], out["approved_at"]).where(review_counts)
    approved_day = out["approved_at"].dt.tz_convert("UTC").dt.tz_localize(None).dt.normalize()
    out["late"] = (approved_day > out["due_date"]).where(out["due_date"].notna() & out["approved_at"].notna())
    return out


def in_progress(df: pd.DataFrame) -> pd.DataFrame:
    """Work in progress that can proceed: started, and waiting on nothing or only on approved work,
    with ``ready_at`` (when it could). What a trial forecasts; work in review is already submitted."""
    work = df[(df["status"] == "IN_PROGRESS") & df["started_at"].notna()].copy()
    free = (work["waits_on"] == 0) | work["blockers_approved_at"].notna()
    work = work[free]
    later = work["blockers_approved_at"].notna() & (work["blockers_approved_at"] > work["started_at"])
    work["ready_at"] = work["started_at"].where(~later, work["blockers_approved_at"])
    return work


def finished(df: pd.DataFrame) -> pd.DataFrame:
    """Approved tasks with a start: the ones a forecast can learn from, oldest approval first."""
    done = df[(df["status"] == "DONE") & df["started_at"].notna() & df["approved_at"].notna()]
    done = with_targets(done)
    done = done[done["work_days"].notna() & np.isfinite(done["work_days"])]
    return done.sort_values(["approved_at", "key"], kind="stable").reset_index(drop=True)
