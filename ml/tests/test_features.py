import math
import tempfile
import unittest
from pathlib import Path

from niveloft_ml import features as f
from niveloft_ml import history as h

from .helpers import row, write


def load(rows):
    with tempfile.TemporaryDirectory() as d:
        return h.read([write(Path(d) / "x.csv", rows)]).tasks


class KnownAtStartTest(unittest.TestCase):
    """Features use only what was known when a task could start: nothing from later work leaks in."""

    def setUp(self):
        # p1 finishes ONB-1 on 2026-01-15 and ONB-2 on 2026-01-14. ONB-2 started before ONB-1 was
        # approved, so it can't learn from it; ONB-3 started after both, so it learns from both.
        self.tasks = load(
            [
                row("ONB-1", person="p1", estimate_days=2, created_at="2026-01-01T09:00:00Z", started_at="2026-01-05T09:00:00Z", last_review_at="2026-01-10T13:48:00Z", approved_at="2026-01-15T09:00:00Z"),
                row("ONB-2", person="p1", estimate_days=3, created_at="2026-01-02T09:00:00Z", started_at="2026-01-08T09:00:00Z", approved_at="2026-01-14T09:00:00Z"),
                row("ONB-3", person="p1", estimate_days=6, created_at="2026-01-14T09:00:00Z", started_at="2026-01-16T09:00:00Z", approved_at="2026-01-30T09:00:00Z"),
                row("ONB-4", person="p2", status="TODO", estimate_days=10, created_at="2026-01-20T09:00:00Z"),
            ]
        )
        self.done = h.finished(self.tasks)
        self.known = f.known_at_start(self.tasks, self.done, self.done)
        self.by = {k: self.known.loc[i] for i, k in zip(self.done.index, self.done["key"])}

    def test_a_task_never_learns_from_work_finished_after_it_started(self):
        self.assertEqual(self.by["ONB-1"]["person_n"], 0)
        self.assertEqual(self.by["ONB-2"]["person_n"], 0)  # ONB-1 was approved after ONB-2 started
        self.assertEqual(self.by["ONB-3"]["person_n"], 2)

    def test_pace_is_the_apps_shrunk_mean_of_log_actual_over_estimate(self):
        a = self.done.set_index("key")
        logs = [math.log(a.loc["ONB-1", "work_days"] / 2), math.log(a.loc["ONB-2", "work_days"] / 3)]
        mean = sum(logs) / 2
        self.assertAlmostEqual(self.by["ONB-3"]["project_pace"], mean)
        self.assertAlmostEqual(self.by["ONB-3"]["person_pace"], (sum(logs) + f.SHRINK * mean) / (2 + f.SHRINK))
        # With no history, the forecast falls back to the project's pace (zero before any work is done).
        self.assertEqual(self.by["ONB-1"]["person_pace"], 0.0)
        self.assertEqual(self.by["ONB-1"]["pace_sigma"], f.DEFAULT_SIGMA)

    def test_typical_estimate_uses_only_tasks_created_by_then(self):
        self.assertEqual(self.by["ONB-1"]["typical_estimate"], 2.5)  # ONB-1 and ONB-2 existed
        self.assertEqual(self.by["ONB-3"]["typical_estimate"], 3.0)  # ONB-4 (estimate 10) came later

    def test_the_feature_table_has_niveloft_s_forecast_in_it(self):
        X = f.build(self.done, self.known)
        self.assertEqual(list(X.columns), f.FEATURES)
        row3 = X.loc[self.done.index[self.done["key"] == "ONB-3"][0]]
        self.assertAlmostEqual(row3["log_pace_forecast"], math.log(6) + self.by["ONB-3"]["person_pace"])
        for outcome in ("submissions", "changes_requested", "review_wait_days", "approved_at"):
            self.assertNotIn(outcome, X.columns)


if __name__ == "__main__":
    unittest.main()
