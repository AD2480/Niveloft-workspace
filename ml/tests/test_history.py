import math
import tempfile
import unittest
from pathlib import Path

from niveloft_ml import history as h

from .helpers import row, write


class ReadingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_refuses_a_file_that_isnt_a_task_history(self):
        bad = self.dir / "bad.csv"
        bad.write_text("project,task\nONB,ONB-1\n", encoding="utf-8")
        with self.assertRaises(h.HistoryError) as e:
            h.read([bad])
        self.assertIn("missing status", str(e.exception))
        self.assertIn("Forecast training data", str(e.exception))

    def test_keeps_the_same_pseudonym_in_two_projects_apart(self):
        a = write(self.dir / "a.csv", [row("ONB-1", person="p1", created_at="2026-01-05T09:00:00Z")])
        b = write(self.dir / "b.csv", [row("CCP-1", person="p1", created_at="2026-01-05T09:00:00Z"), row("CCP-2", created_at="2026-01-05T09:00:00Z")])
        t = h.read([a, b]).tasks
        self.assertEqual(t["person"].tolist()[:2], ["ONB:p1", "CCP:p1"])
        self.assertTrue(t["person"].isna().tolist()[2])

    def test_marks_synthetic_data(self):
        f = write(self.dir / "s.csv", [row("SYN-1", created_at="2026-01-05T09:00:00Z")])
        self.assertTrue(h.read([f]).synthetic)
        f = write(self.dir / "r.csv", [row("ONB-1", created_at="2026-01-05T09:00:00Z")])
        self.assertFalse(h.read([f]).synthetic)


class TargetTest(unittest.TestCase):
    """The target is Niveloft's own: working time from when work could proceed to its final submission."""

    def table(self, rows):
        with tempfile.TemporaryDirectory() as d:
            return h.finished(h.read([write(Path(d) / "x.csv", rows)]).tasks)

    def test_counts_from_the_start_to_the_last_submission(self):
        t = self.table([row("ONB-1", created_at="2026-01-01T09:00:00Z", started_at="2026-01-05T09:00:00Z", last_review_at="2026-01-12T09:00:00Z", approved_at="2026-01-13T09:00:00Z")])
        self.assertAlmostEqual(t.loc[0, "work_days"], 7 * 5 / 7)
        self.assertAlmostEqual(t.loc[0, "review_wait_days"], 1.0)

    def test_waiting_for_other_work_isnt_counted(self):
        t = self.table(
            [row("ONB-2", created_at="2026-01-01T09:00:00Z", started_at="2026-01-05T09:00:00Z", blockers_approved_at="2026-01-08T09:00:00Z", last_review_at="2026-01-15T09:00:00Z", approved_at="2026-01-16T09:00:00Z")]
        )
        self.assertAlmostEqual(t.loc[0, "work_days"], 7 * 5 / 7)

    def test_without_a_review_it_ends_at_approval_and_never_below_a_quarter_day(self):
        t = self.table(
            [
                row("ONB-3", created_at="2026-01-01T09:00:00Z", started_at="2026-01-05T09:00:00Z", approved_at="2026-01-07T09:00:00Z"),
                row("ONB-4", created_at="2026-01-01T09:00:00Z", started_at="2026-01-05T09:00:00Z", approved_at="2026-01-05T10:00:00Z"),
            ]
        )
        by_key = dict(zip(t["key"], t["work_days"]))
        self.assertAlmostEqual(by_key["ONB-3"], 2 * 5 / 7)
        self.assertAlmostEqual(by_key["ONB-4"], h.MIN_WORK_DAYS)
        self.assertTrue(math.isnan(t.loc[0, "review_wait_days"]))

    def test_learns_only_from_approved_work_with_a_start(self):
        t = self.table(
            [
                row("ONB-5", status="IN_REVIEW", created_at="2026-01-01T09:00:00Z", started_at="2026-01-05T09:00:00Z", last_review_at="2026-01-07T09:00:00Z"),
                row("ONB-6", created_at="2026-01-01T09:00:00Z", approved_at="2026-01-07T09:00:00Z"),
                row("ONB-7", due_date="2026-01-06", created_at="2026-01-01T09:00:00Z", started_at="2026-01-02T09:00:00Z", approved_at="2026-01-07T09:00:00Z"),
            ]
        )
        self.assertEqual(t["key"].tolist(), ["ONB-7"])
        self.assertTrue(bool(t.loc[0, "late"]))


if __name__ == "__main__":
    unittest.main()
