import tempfile
import unittest
from pathlib import Path

import numpy as np

from niveloft_ml import evaluate as e
from niveloft_ml import history as h
from niveloft_ml import models as m
from niveloft_ml import synthetic


def synthetic_history(**kw) -> h.History:
    with tempfile.TemporaryDirectory() as d:
        return h.read([synthetic.write(Path(d) / "SYN-task-history-v1.csv", **kw)])


class SplitTest(unittest.TestCase):
    def test_trains_on_earlier_work_and_tests_on_work_started_later(self):
        done = h.finished(synthetic_history(tasks=300, seed=3).tasks)
        train, test, cut = e.time_split(done, 0.25)
        self.assertTrue((done.loc[train, "approved_at"] <= cut).all())
        self.assertTrue((done.loc[test, "ready_at"] > cut).all())
        self.assertEqual(len(set(train) & set(test)), 0)
        self.assertLessEqual(len(test), round(len(done) * 0.25))
        self.assertGreater(len(test), 0)


class CompareTest(unittest.TestCase):
    def test_no_difference_is_no_gain(self):
        err = np.abs(np.random.default_rng(1).normal(0, 0.3, 200))
        gain, (lo, hi), ahead = e.compare(err, err.copy(), 500, 1)
        self.assertEqual(gain, 0.0)
        self.assertEqual(ahead, 0.0)  # never strictly ahead
        self.assertLessEqual(lo, 0.0)

    def test_a_real_improvement_is_seen_reliably(self):
        rng = np.random.default_rng(2)
        base = np.abs(rng.normal(0, 0.4, 300))
        gain, (lo, _), ahead = e.compare(base, base * 0.8, 500, 2)
        self.assertAlmostEqual(gain, 0.2)
        self.assertGreater(lo, 0.1)
        self.assertEqual(ahead, 1.0)


class DecisionTest(unittest.TestCase):
    """A model is recommended only when it beats Niveloft's forecast by a margin, reliably."""

    def test_finds_what_the_forecast_misses_when_there_is_something(self):
        out, fitted = e.run(synthetic_history(tasks=1200, seed=7), m.candidates()[0], e.Settings())
        self.assertEqual(out.decision["verdict"], "model-is-better", out.decision["why"])
        self.assertIn(out.decision["recommend"], {"ridge", "correction", "forest", "gbm"})
        self.assertIsNotNone(fitted)
        best = next(s for s in out.scores if s.name == out.decision["recommend"])
        niveloft = next(s for s in out.scores if s.name == "niveloft")
        self.assertLess(best.typical_miss, niveloft.typical_miss)
        self.assertTrue(out.data["synthetic"])

    def test_keeps_niveloft_s_forecast_when_there_is_nothing_more_to_learn(self):
        for seed in (7, 11):
            out, fitted = e.run(synthetic_history(tasks=1200, seed=seed, plain=True), m.candidates()[0], e.Settings())
            self.assertEqual(out.decision["verdict"], "keep-niveloft", out.decision["why"])
            self.assertIsNone(fitted)

    def test_says_when_there_is_too_little_history(self):
        out, fitted = e.run(synthetic_history(tasks=60, seed=5), m.candidates()[0], e.Settings())
        self.assertEqual(out.decision["verdict"], "not-enough-history")
        self.assertIn("a fair test needs at least 60 and 30", out.decision["why"])
        self.assertIsNone(fitted)

    def test_niveloft_s_ranges_are_checked(self):
        out, _ = e.run(synthetic_history(tasks=600, seed=7), m.candidates()[0], e.Settings(min_train=10, min_test=10))
        self.assertTrue(0.5 < out.niveloft_range_coverage <= 1.0)


if __name__ == "__main__":
    unittest.main()
