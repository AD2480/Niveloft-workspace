"""Small task histories written by hand, in Niveloft's export format."""

from __future__ import annotations

import csv
from pathlib import Path

from niveloft_ml.history import COLUMNS


def row(task: str, **kw) -> dict:
    base = {c: "" for c in COLUMNS}
    base.update(project=task.split("-")[0], task=task, status="DONE", priority="MEDIUM", waits_on="0", holds_up="0", criteria="0", checklist="0", description_chars="0", submissions="1", changes_requested="0")
    base.update({k: str(v) for k, v in kw.items()})
    return base


def write(path: Path, rows: list[dict]) -> Path:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return path
