import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from niveloft_ml import evaluate as e
from niveloft_ml import export
from niveloft_ml import features as feat
from niveloft_ml import history as h
from niveloft_ml import models as m
from niveloft_ml import report, synthetic


def training(tasks=400, seed=7):
    with tempfile.TemporaryDirectory() as d:
        hist = h.read([synthetic.write(Path(d) / "SYN-task-history-v1.csv", tasks=tasks, seed=seed)])
    done = h.finished(hist.tasks)
    X = feat.build(done, feat.known_at_start(hist.tasks, done, done))
    return hist, done, X, np.log(done["work_days"].to_numpy(dtype=float))


class PortableModelTest(unittest.TestCase):
    """Every built-in candidate exports, and the exported numbers predict what scikit-learn does."""

    def test_each_kind_predicts_what_scikit_learn_does(self):
        _, _, X, y = training()
        self.assertTrue(X.isna().to_numpy().any())  # missing estimates, due dates and paces are in it
        for c in m.candidates()[0]:
            model = c.make().fit(X, y)
            doc = export.document(c.name, c.description, model, list(X.columns), {"finished_with_start": len(X), "projects": ["SYN"], "synthetic": True}, {}, None)
            doc = json.loads(json.dumps(doc, allow_nan=False))  # as the server reads it
            got = export.predict(doc, X)
            want = model.predict(X)
            self.assertLess(float(np.max(np.abs(got - want))), 1e-9, c.name)
            self.assertEqual(doc["model"]["kind"], {"ridge": "linear", "forest": "forest", "gbm": "gbm", "correction": "correction"}[c.name])

    def test_says_what_it_cannot_hold(self):
        with self.assertRaises(export.NotPortable):
            export.model_part("xgboost", object())

    def test_a_winning_model_is_written_for_the_server_with_how_to_try_it(self):
        hist, done, _, _ = training(tasks=1200, seed=7)
        out, fitted = e.run(hist, m.candidates()[0], e.Settings())
        self.assertIsNotNone(fitted)
        with tempfile.TemporaryDirectory() as d:
            files = [p.name for p in report.write(out, d, fitted)]
            self.assertIn("model.json", files)
            doc = json.loads((Path(d) / "model.json").read_text(encoding="utf-8"))
            text = (Path(d) / "report.md").read_text(encoding="utf-8")
        self.assertEqual((doc["schema"], doc["source"]), (export.SCHEMA, export.SOURCE))
        self.assertEqual(doc["features"], feat.FEATURES)
        self.assertTrue(doc["trained"]["synthetic"])
        self.assertEqual(doc["trained"]["through"][:19], done["approved_at"].max().isoformat()[:19])
        self.assertIn("FORECAST_MODEL_FILE", text)
        # The file as written predicts what the fitted model does (splits at infinity included).
        X = feat.build(done, feat.known_at_start(hist.tasks, done, done))
        self.assertLess(float(np.max(np.abs(export.predict(doc, X) - fitted["model"].predict(X)))), 1e-9, doc["name"])

    def test_work_in_progress_that_can_proceed(self):
        hist, _, _, _ = training(tasks=1200, seed=7)
        work = h.in_progress(hist.tasks)
        self.assertGreater(len(work), 0)
        self.assertTrue((work["status"] == "IN_PROGRESS").all())
        self.assertTrue((work["ready_at"] >= work["started_at"]).all())
        waiting = work[(work["waits_on"] > 0)]
        self.assertTrue(waiting["blockers_approved_at"].notna().all())


if __name__ == "__main__":
    unittest.main()
