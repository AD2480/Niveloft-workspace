"""Writes the files the server's tests use to check that its Java builds the same features and
makes the same predictions as this kit (backend/src/test/resources/forecast/):

  history.csv        a made-up task history (project SYN), in the export format
  model-<kind>.json  each kind of model the server runs, fitted on it (small, to keep files small)
  expected.csv       for every finished task and every task in progress that can proceed: when it
                     could proceed, its features, and each model's prediction by scikit-learn

Run from ml/:  python scripts/forecast_parity_fixture.py ../backend/src/test/resources/forecast
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from niveloft_ml import export  # noqa: E402
from niveloft_ml import features as feat  # noqa: E402
from niveloft_ml import history as h  # noqa: E402
from niveloft_ml import synthetic  # noqa: E402
from niveloft_ml.models import Correction  # noqa: E402


def fmt(v: float) -> str:
    return "" if v != v else repr(float(v))  # NaN → empty; full precision otherwise


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = synthetic.write(out / "history.csv", tasks=260, seed=21)
    hist = h.read([path])
    done = h.finished(hist.tasks)
    work = h.in_progress(hist.tasks)
    X_done = feat.build(done, feat.known_at_start(hist.tasks, done, done))
    X_work = feat.build(work, feat.known_at_start(hist.tasks, done, work))
    y = np.log(done["work_days"].to_numpy(dtype=float))
    models = {
        "linear": make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(), Ridge(alpha=1.0)),
        "gbm": HistGradientBoostingRegressor(max_iter=40, learning_rate=0.1, max_leaf_nodes=15, min_samples_leaf=10, random_state=0),
        "correction": Correction(random_state=0),
        "forest": make_pipeline(SimpleImputer(strategy="median", add_indicator=True), RandomForestRegressor(n_estimators=8, min_samples_leaf=3, random_state=0)),
    }
    data = {"finished_with_start": len(done), "projects": ["SYN"], "people": int(hist.tasks["person"].nunique()), "synthetic": True}
    through = done["approved_at"].max().isoformat()
    predictions = {}
    for kind, model in models.items():
        model.fit(X_done, y)
        doc = export.document(kind, f"parity fixture ({kind})", model, feat.FEATURES, data, {"verdict": "fixture"}, through)
        export.write(doc, out / f"model-{kind}.json")
        sk = np.concatenate([model.predict(X_done), model.predict(X_work)])
        mine = np.concatenate([export.predict(doc, X_done), export.predict(doc, X_work)])
        assert float(np.max(np.abs(sk - mine))) < 1e-9, kind
        predictions[kind] = sk
    with (out / "expected.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["kind", "task", "ready_at", "work_days", *feat.FEATURES, *[f"predict_{k}" for k in models]])
        rows = [("finished", r) for _, r in done.iterrows()] + [("in_progress", r) for _, r in work.iterrows()]
        X = np.vstack([X_done.to_numpy(dtype=float), X_work.to_numpy(dtype=float)])
        for i, (kind, r) in enumerate(rows):
            w.writerow([kind, r["task"], r["ready_at"].isoformat(), fmt(r["work_days"]) if kind == "finished" else "",
                        *[fmt(v) for v in X[i]], *[fmt(predictions[k][i]) for k in models]])
    print(f"wrote {len(done)} finished and {len(work)} in progress to {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../backend/src/test/resources/forecast")
