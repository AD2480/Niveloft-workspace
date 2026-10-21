"""A made-up task history in Niveloft's format, for trying the kit before you have your own.

Every file it writes is for project ``SYN``, and every report made from it says it's synthetic:
its numbers describe this generator, not any real team. The generator has effects Niveloft's
forecast doesn't model (large tasks overrun more than small ones, acceptance criteria add work,
urgent work moves faster), so it's also a check that the kit can find an improvement when one
exists, and refuses one when it doesn't (``--plain`` leaves only what the forecast models).
"""

from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .history import COLUMNS, SYNTHETIC_PROJECT

PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"]


def _iso(t: datetime | None) -> str:
    return "" if t is None else t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def generate(tasks: int = 1200, people: int = 8, seed: int = 7, plain: bool = False, start: datetime | None = None) -> list[dict]:
    """Rows in the task-history format. ``plain``: work is just estimate × personal pace × noise."""
    rng = np.random.default_rng(seed)
    t0 = start or datetime(2025, 1, 6, 9, 0, tzinfo=timezone.utc)
    # New work arrives about as fast as the team finishes it, so most of it gets done.
    gap = 6.5 / people
    horizon = t0 + timedelta(days=tasks * gap + 20)
    pace = np.exp(rng.normal(0, 0.35, size=people))
    free_at = [t0] * people
    rows: list[dict] = []
    approved_at: list[datetime | None] = []
    waits: dict[int, list[int]] = {}
    for i in range(tasks):
        created = t0 + timedelta(days=float(i * gap + rng.uniform(0, 2)))
        person = int(rng.integers(0, people)) if rng.random() > 0.04 else None
        size = float(np.clip(rng.lognormal(1.0, 0.6), 0.5, 15))
        estimated = rng.random() < 0.85
        estimate = max(1, int(round(size * float(np.exp(rng.normal(0, 0.15)))))) if estimated else None
        priority = PRIORITIES[int(rng.choice(4, p=[0.15, 0.45, 0.3, 0.1]))]
        criteria = int(rng.integers(0, 7))
        checklist = int(rng.integers(0, 9))
        description = int(rng.integers(0, 1500))
        blockers = []
        if i > 5 and rng.random() < 0.2:
            blockers = [int(rng.integers(max(0, i - 30), i))]
            waits[i] = blockers
        work = size * (pace[person] if person is not None else 1.0)
        if not plain:
            work *= (size / 3.0) ** 0.35  # large tasks overrun more than small ones
            work *= 1 + 0.1 * criteria  # every acceptance criterion adds checking
            work *= {"URGENT": 0.7, "HIGH": 0.85, "MEDIUM": 1.0, "LOW": 1.3}[priority]
        work *= float(np.exp(rng.normal(0, 0.2)))
        queue = timedelta(days=float(rng.exponential(2.0)))
        started = max(created + queue, free_at[person] if person is not None else created)
        ready = started
        blocker_done = [approved_at[b] for b in blockers]
        if blockers and all(d is not None for d in blocker_done):
            ready = max(started, max(blocker_done))  # type: ignore[type-var]
        submitted = ready + timedelta(days=work * 7 / 5)
        review = submitted + timedelta(days=float(rng.lognormal(0, 0.5)))
        submissions, changes = 1, 0
        if rng.random() < 0.12:  # changes requested once
            changes = 1
            submissions = 2
            submitted = review + timedelta(days=float(rng.uniform(0.3, 1.5)))
            review = submitted + timedelta(days=float(rng.lognormal(-0.3, 0.5)))
        due = (created + timedelta(days=float((estimate or size) * 7 / 5 + rng.uniform(1, 5)))).date()
        if person is not None:
            free_at[person] = submitted
        if review <= horizon:
            status, s_at, r_at, a_at = "DONE", started, submitted, review
        elif submitted <= horizon:
            status, s_at, r_at, a_at = "IN_REVIEW", started, submitted, None
        elif started <= horizon:
            status, s_at, r_at, a_at = "IN_PROGRESS", started, None, None
        else:
            status, s_at, r_at, a_at = "TODO", None, None, None
        approved_at.append(a_at)
        rows.append(
            {
                "project": SYNTHETIC_PROJECT,
                "task": f"{SYNTHETIC_PROJECT}-{i + 1}",
                "status": status,
                "priority": priority,
                "estimate_days": "" if estimate is None else str(estimate),
                "person": "" if person is None else f"p{person + 1}",
                "created_at": _iso(created),
                "started_at": _iso(s_at),
                "blockers_approved_at": _iso(max(blocker_done)) if blockers and all(d is not None for d in blocker_done) else "",  # type: ignore[type-var]
                "last_review_at": _iso(r_at) if status in ("DONE", "IN_REVIEW") else "",
                "approved_at": _iso(a_at),
                "due_date": due.isoformat(),
                "waits_on": str(len(blockers)),
                "holds_up": "0",
                "criteria": str(criteria),
                "checklist": str(checklist),
                "description_chars": str(description),
                "submissions": str(submissions if status in ("DONE", "IN_REVIEW") else 0),
                "changes_requested": str(changes if status == "DONE" else 0),
            }
        )
    for blocked, blockers in waits.items():  # holds_up: how many tasks wait on each one
        for b in blockers:
            rows[b]["holds_up"] = str(int(rows[b]["holds_up"]) + 1)
    return rows


def write(path: str | Path, **kw) -> Path:
    p = Path(path)
    rows = generate(**kw)
    with p.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return p
