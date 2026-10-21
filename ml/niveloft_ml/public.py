"""First experiments on public data, before your own history is big enough.

  jira     a Jira issues export, converted to Niveloft's task-history format through a column
           mapping, then the same comparison as your own data (created → resolved, since Jira
           has no start or review dates)
  effort   whole-project effort estimation (the Desharnais data, ARFF or CSV): models against
           the classic function-point regression, with cross-validation (there are no dates to
           split on), using only what's known when a project is estimated
  tabular  any table with a target column: a regression or a classification (--classify), with
           a time split when there's a date column, cross-validation otherwise; identifier
           columns are left out
  tickets  text classification (for example a support ticket's priority): words in, label out,
           each text once, and versions of one dataset measured apart, never pooled

Public data is for learning what works, not for shipping: its licence decides whether a model
trained on it may be used in a product (see datasets.json). A model trained on data marked
non-commercial is never saved.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression, Ridge
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score
from sklearn.model_selection import KFold, StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from . import arff
from . import history as hist

REGISTRY = Path(__file__).resolve().parent.parent / "datasets.json"


def registry() -> dict:
    data = json.loads(REGISTRY.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


def licence_note(dataset: str | None) -> tuple[str, bool]:
    """A line about the dataset's licence, and whether a model trained on it may be saved."""
    entry = registry().get(dataset or "")
    if not entry:
        return ("Licence: not recorded here. Check the data’s source before using a model trained on it in a product.", True)
    commercial = entry["commercial_use"]
    note = f"{entry['name']}. Licence: {entry['licence'].rstrip('.')}. Commercial use: {commercial}. {entry['caution']}"
    return note, commercial != "no"


# ---------------------------------------------------------------- Jira → Niveloft's format


def jira(path: str | Path, mapping: dict) -> pd.DataFrame:
    """A Jira issues export as a Niveloft task history (all text and names left out)."""
    df = pd.read_csv(path, dtype=str, keep_default_na=False, low_memory=False)

    def col(name: str) -> pd.Series:
        c = mapping.get(name)
        if not c:
            return pd.Series([""] * len(df), index=df.index, dtype=str)
        if c not in df.columns:
            raise hist.HistoryError(f"The mapping says “{name}” is the column “{c}”, but the file has no such column. Columns: {', '.join(df.columns[:40])}")
        return df[c].fillna("").astype(str)

    def na(s: pd.Series) -> pd.Series:
        return s.where(s.str.strip() != "")

    created = pd.to_datetime(na(col("created")), utc=True, errors="coerce", format="mixed")
    resolved = pd.to_datetime(na(col("resolved")), utc=True, errors="coerce", format="mixed")
    started = pd.to_datetime(na(col("started")), utc=True, errors="coerce", format="mixed") if mapping.get("started") else created
    status_ok = col("status").isin(mapping.get("done_statuses") or []) if mapping.get("status") else pd.Series(True, index=df.index)
    resolution_ok = col("resolution").isin(mapping.get("done_resolutions") or []) if mapping.get("resolution") else pd.Series(True, index=df.index)
    done = status_ok & resolution_ok & resolved.notna() & started.notna() & (resolved > started)
    seconds = pd.to_numeric(na(col("estimate_seconds")), errors="coerce")
    estimate = (seconds / 3600 / float(mapping.get("hours_per_day") or 8)).round(2)
    people: dict[str, str] = {}
    person = col("assignee").map(lambda a: "" if not a or a.lower() in ("unassigned", "none") else people.setdefault(a, f"p{len(people) + 1}"))
    project = col("project").replace("", "JIRA").str.upper().str.replace(r"[^A-Z0-9]+", "", regex=True).str[:10]
    key = col("key").where(col("key") != "", project + "-" + pd.Series(range(1, len(df) + 1), index=df.index).astype(str))
    pmap = mapping.get("priority_map") or {}
    due = pd.to_datetime(na(col("due")), errors="coerce", format="mixed").dt.strftime("%Y-%m-%d").fillna("")

    def iso(s: pd.Series) -> pd.Series:
        return s.dt.strftime("%Y-%m-%dT%H:%M:%SZ").fillna("")

    out = pd.DataFrame(
        {
            "project": project,
            "task": key,
            "status": np.where(done, "DONE", "IN_PROGRESS"),
            "priority": col("priority").map(lambda p: pmap.get(p, "MEDIUM")),
            "estimate_days": estimate.map(lambda e: "" if pd.isna(e) or e <= 0 else f"{e:g}"),
            "person": person,
            "created_at": iso(created),
            "started_at": iso(started),
            "blockers_approved_at": "",
            "last_review_at": "",
            "approved_at": iso(resolved.where(done)),
            "due_date": due,
            "waits_on": "0",
            "holds_up": "0",
            "criteria": "0",
            "checklist": "0",
            "description_chars": col("description").str.len().astype(str),
            "submissions": "0",
            "changes_requested": "0",
        }
    )
    return out[hist.COLUMNS]


# ---------------------------------------------------------------- sources


def sha256(path: str | Path) -> str:
    """The file's SHA-256, so a report says exactly which download it measured."""
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def source(path: str | Path) -> dict:
    p = Path(path)
    return {"file": p.name, "bytes": p.stat().st_size, "sha256": sha256(p)}


def source_line(src: dict) -> str:
    return f"Source: {src['file']} ({src['bytes']:,} bytes, SHA-256 {src['sha256']})."


# ---------------------------------------------------------------- shared results


@dataclass
class Table:
    title: str
    licence: str
    setup: str
    headers: list[str]
    rows: list[list[str]]
    decision: str
    may_save: bool
    notes: list[str] = field(default_factory=list)
    #: The numbers behind the table, for SUMMARY.md and anyone comparing runs.
    facts: dict = field(default_factory=dict)

    def markdown(self) -> str:
        lines = [f"# {self.title}", "", f"> {self.licence}", "", "## The decision", "", self.decision, "", "## The setup", "", self.setup, "", "## Results", ""]
        lines.append("| " + " | ".join(self.headers) + " |")
        lines.append("|" + "|".join("---" if i == 0 else "---:" for i in range(len(self.headers))) + "|")
        lines += ["| " + " | ".join(r) + " |" for r in self.rows]
        if self.notes:
            lines += ["", "## Notes", "", *[f"- {n}" for n in self.notes]]
        return "\n".join(lines) + "\n"

    def write(self, folder: str | Path) -> list[Path]:
        p = Path(folder)
        p.mkdir(parents=True, exist_ok=True)
        (p / "report.md").write_text(self.markdown(), encoding="utf-8")
        (p / "report.json").write_text(json.dumps(self.__dict__, indent=2, default=str), encoding="utf-8")
        return [p / "report.md", p / "report.json"]


def _regression_metrics(preds: dict[str, np.ndarray], actual: np.ndarray, baseline: str, rounds: int = 2000, seed: int = 7) -> dict[str, dict]:
    from .evaluate import compare

    log_actual = np.log(actual)
    base_err = np.abs(np.log(preds[baseline]) - log_actual)
    out = {}
    for name, pred in preds.items():
        err = np.abs(pred - actual)
        log_err = np.abs(np.log(pred) - log_actual)
        m = {"median_miss": float(np.median(err)), "mean_miss": float(err.mean()), "typical_miss": math.exp(log_err.mean()), "within_25": float(np.mean(log_err <= math.log(1.25)))}
        if name != baseline:
            gain, (lo, hi), ahead = compare(base_err, log_err, rounds, seed)
            m.update(gain=float(gain), gain_low=float(lo), gain_high=float(hi), ahead=float(ahead))
        out[name] = m
    return out


def _regression_rows(preds: dict[str, np.ndarray], actual: np.ndarray, baseline: str, rounds: int = 2000, seed: int = 7) -> tuple[list[list[str]], str, str]:
    rows, verdict, best, _ = _regression_summary(preds, actual, baseline, rounds, seed)
    return rows, verdict, best


def _regression_summary(preds, actual, baseline, rounds=2000, seed=7) -> tuple[list[list[str]], str, str, dict]:
    metrics = _regression_metrics(preds, actual, baseline, rounds, seed)
    rows, best, best_miss = [], None, math.inf
    for name, m in metrics.items():
        cells = [name, f"{m['median_miss']:.1f}", f"{m['mean_miss']:.1f}", f"×{m['typical_miss']:.2f}", f"{m['within_25']:.0%}"]
        if name == baseline:
            cells.append("(the baseline)")
        else:
            cells.append(f"{m['gain']:+.0%} ({m['gain_low']:+.0%} to {m['gain_high']:+.0%}), ahead in {m['ahead']:.0%}")
            if m["typical_miss"] < best_miss:
                best, best_miss = name, m["typical_miss"]
        rows.append(cells)
    if best and metrics[best]["gain"] >= 0.05 and metrics[best]["ahead"] >= 0.95:
        verdict = f"{best[:1].upper()}{best[1:]} beats {baseline}: {metrics[best]['gain']:.0%} of its typical miss removed, ahead in {metrics[best]['ahead']:.0%} of resamples."
    elif best:
        verdict = f"Nothing beats {baseline} reliably here (best: {best}, {metrics[best]['gain']:+.0%}, ahead in {metrics[best]['ahead']:.0%})."
    else:
        verdict = "No model could be compared."
    return rows, verdict, best or "", metrics


# ---------------------------------------------------------------- effort (Desharnais)

DESHARNAIS = {
    "target": "Effort",
    "size": "PointsAjust",
    # What's known when a project is estimated: experience, the function-point counts, the language.
    "numeric": ["TeamExp", "ManagerExp", "Transactions", "Entities", "PointsNonAdjust", "Adjustment", "PointsAjust"],
    "categorical": ["Language"],
    # The dataset writes -1 where nothing was recorded (four projects).
    "missing": {"TeamExp": [-1], "ManagerExp": [-1]},
    # Never inputs: an identifier, or something known only once the project is over.
    "excluded": {
        "Project": "an identifier, not a property of the work",
        "Length": "the actual schedule in months, known only once the project is over",
        "YearEnd": "the year the project ended, known only at the end",
    },
}


def _effort_cv(df: pd.DataFrame, spec: dict, folds: int, repeats: int, seed: int) -> tuple[dict[str, np.ndarray], np.ndarray]:
    y = df[spec["target"]].to_numpy(float)
    X = df[spec["numeric"] + spec["categorical"]]
    pre = ColumnTransformer(
        [
            # Fitted inside each training fold, so a missing value is filled from training projects only.
            ("num", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), spec["numeric"]),
            ("cat", make_pipeline(SimpleImputer(strategy="most_frequent"), OneHotEncoder(handle_unknown="ignore")), spec["categorical"]),
        ]
    )
    models = {
        "ridge": lambda: make_pipeline(pre, Ridge(alpha=1.0)),
        "forest": lambda: make_pipeline(pre, RandomForestRegressor(n_estimators=300, min_samples_leaf=2, random_state=seed)),
        "gbm": lambda: make_pipeline(pre, HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, min_samples_leaf=5, random_state=seed)),
    }
    names = ["median effort", "function points"] + list(models)
    preds = {n: np.zeros(len(df) * repeats) for n in names}
    size = df[spec["size"]].to_numpy(float)
    for r in range(repeats):
        for train, test in KFold(folds, shuffle=True, random_state=seed + r).split(X):
            off = r * len(df)
            preds["median effort"][off + test] = np.median(y[train])
            ok = np.isfinite(size[train]) & (size[train] > 0)
            fp = LinearRegression().fit(np.log(size[train][ok]).reshape(-1, 1), np.log(y[train][ok]))
            s_test = np.where(np.isfinite(size[test]) & (size[test] > 0), size[test], np.nanmedian(size[train]))
            preds["function points"][off + test] = np.exp(fp.predict(np.log(s_test).reshape(-1, 1)))
            for n, make in models.items():
                m = make().fit(X.iloc[train], np.log(y[train]))
                preds[n][off + test] = np.exp(m.predict(X.iloc[test]))
    return preds, np.tile(y, repeats)


def effort(path: str | Path, spec: dict | None = None, folds: int = 5, repeats: int = 3, seed: int = 7, dataset: str = "desharnais") -> Table:
    """Whole-project effort, by repeated cross-validation, against the function-point regression.

    Reads ARFF (the PROMISE file) or CSV. Inputs are only what's known when a project is
    estimated: the spec's ``excluded`` columns (an identifier, the actual schedule, the end year)
    are never used, and its ``missing`` markers become missing values, filled inside each training
    fold.
    """
    spec = spec or DESHARNAIS
    inputs = spec["numeric"] + spec["categorical"]
    leaks = sorted(set(inputs) & set(spec.get("excluded") or {}))
    if leaks:
        raise hist.HistoryError(f"These columns can't be both inputs and excluded: {', '.join(leaks)}")
    df = arff.read_table(path)
    absent = [c for c in [spec["target"], spec["size"], *inputs] if c not in df.columns]
    if absent:
        raise hist.HistoryError(f"{path}: missing columns {', '.join(absent)}. Columns: {', '.join(map(str, df.columns))}")
    for c in [spec["target"], *spec["numeric"]]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in spec["categorical"]:
        df[c] = df[c].map(lambda v: np.nan if pd.isna(v) else str(v).removesuffix(".0"))
    marked: dict[str, int] = {}
    for c, markers in (spec.get("missing") or {}).items():
        if c in df.columns:
            hit = df[c].isin(markers)
            marked[c] = int(hit.sum())
            df.loc[hit, c] = np.nan
    rows_in = len(df)
    df = df[df[spec["target"]] > 0].reset_index(drop=True)
    incomplete = int(df[inputs].isna().any(axis=1).sum())

    preds, actual = _effort_cv(df, spec, folds, repeats, seed)
    rows, verdict, best, metrics = _regression_summary(preds, actual, "function points")
    licence, may_save = licence_note(dataset)
    src = source(path)
    excluded = {c: why for c, why in (spec.get("excluded") or {}).items() if c in df.columns}
    notes = [source_line(src)]
    if excluded:
        notes.append("Never used as inputs: " + "; ".join(f"{c} ({why})" for c, why in excluded.items()) + ".")
    if marked:
        notes.append(
            "Missing values: "
            + ", ".join(f"{n} in {c}" for c, n in marked.items() if n)
            + f" (written as {', '.join(sorted({str(m) for ms in spec['missing'].values() for m in ms}))} in the file), across {incomplete} projects; each is filled with the median of the training projects in its fold."
        )
    facts = {
        "source": src,
        "projects": len(df),
        "rows_in_file": rows_in,
        "inputs": inputs,
        "excluded": list(excluded),
        "missing_values": marked,
        "incomplete_projects": incomplete,
        "best": best,
        "metrics": metrics,
    }
    if incomplete:
        complete = df.dropna(subset=inputs).reset_index(drop=True)
        if len(complete) >= folds * 3:
            p2, a2 = _effort_cv(complete, spec, folds, repeats, seed)
            _, verdict2, best2, metrics2 = _regression_summary(p2, a2, "function points")
            m2 = metrics2[best2]
            notes.append(
                f"With only the {len(complete)} projects that have nothing missing: best {best2}, typical miss ×{m2['typical_miss']:.2f} against ×{metrics2['function points']['typical_miss']:.2f} for function points "
                f"({m2['gain']:+.0%} of its miss, ahead in {m2['ahead']:.0%} of resamples)."
            )
            facts["complete_cases"] = {"projects": len(complete), "best": best2, "metrics": metrics2}
    return Table(
        title="Effort estimation on public data",
        licence=licence,
        setup=f"{len(df)} projects, {folds}-fold cross-validation repeated {repeats} times (there are no dates to split on). Inputs: {', '.join(inputs)}. Models predict log effort; misses are in the target’s units ({spec['target']}).",
        headers=["Method", "Median miss", "Mean miss", "Typical miss", "Within ±25%", "Against function points"],
        rows=rows,
        decision=verdict + " This is research on whole projects, not Niveloft’s task forecast: use it to judge methods, not to replace the forecast.",
        may_save=may_save,
        notes=notes,
        facts=facts,
    )


# ---------------------------------------------------------------- any table

#: Names that say a column identifies a row rather than describing it: id, uuid, Project_ID, ProjectId, record no …
_ID_NAME = re.compile(r"(?i)^(id|ids|uuid|guid|index|unnamed: ?\d+)$|(^|[_\s.-])(id|ids|uuid|guid)$|^(project|task|record|row|case|ticket)[_\s.-]?(id|key|code|number|no|nr)$")
_CAMEL_ID = re.compile(r"[a-z](Id|ID)$")


def identifier_columns(df: pd.DataFrame, target: str) -> dict[str, str]:
    """Columns that identify rows rather than describe them, with why. A model that learns from an
    identifier learns which rows it has seen, which says nothing about new ones."""
    out: dict[str, str] = {}
    n = len(df)
    for c in df.columns:
        if c == target:
            continue
        name = str(c)
        if _ID_NAME.search(name) or _CAMEL_ID.search(name):
            out[c] = "its name says it identifies a row"
            continue
        s = df[c].dropna()
        if n < 20 or len(s) != n or s.nunique() != n:
            continue
        if not pd.api.types.is_numeric_dtype(s):
            out[c] = "a different text value on every row"
        elif np.all(np.mod(s.to_numpy(float), 1) == 0) and np.all(np.diff(np.sort(s.to_numpy(float))) == 1):
            out[c] = "a running number"
    return out


def tabular(path: str | Path, target: str, classify: bool = False, time_col: str | None = None, drop: list[str] | None = None, dataset: str | None = None, seed: int = 7, keep: list[str] | None = None) -> Table:
    df = arff.read_table(path)
    if target not in df.columns:
        raise hist.HistoryError(f"{path}: there’s no column “{target}”. Columns: {', '.join(map(str, df.columns))}")
    df = df.dropna(subset=[target]).reset_index(drop=True)
    ids = {c: why for c, why in identifier_columns(df, target).items() if c not in set(keep or []) and c != time_col}
    drop = set(drop or []) | {target} | ({time_col} if time_col else set()) | set(ids)
    feats = [c for c in df.columns if c not in drop]
    numeric = [c for c in feats if pd.api.types.is_numeric_dtype(df[c])]
    categorical = [c for c in feats if c not in numeric and df[c].nunique() <= 50]
    skipped = [c for c in feats if c not in numeric and c not in categorical]
    pre = ColumnTransformer(
        [
            ("num", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), numeric),
            ("cat", make_pipeline(SimpleImputer(strategy="most_frequent"), OneHotEncoder(handle_unknown="ignore")), categorical),
        ]
    )
    X, y = df[numeric + categorical], df[target]
    if time_col:
        order = np.argsort(pd.to_datetime(df[time_col], errors="coerce").to_numpy())
        cut = int(len(df) * 0.75)
        splits = [(order[:cut], order[cut:])]
        how = f"trained on the earliest 75% by {time_col}, tested on the latest 25%"
    else:
        cv = StratifiedKFold(5, shuffle=True, random_state=seed) if classify else KFold(5, shuffle=True, random_state=seed)
        splits = list(cv.split(X, y if classify else None))
        how = "5-fold cross-validation"
    licence, may_save = licence_note(dataset)
    src = source(path)
    notes = [source_line(src)]
    if ids:
        notes.append("Left out as identifiers: " + "; ".join(f"{c} ({why})" for c, why in ids.items()) + ". Use --keep to keep one.")
    if skipped:
        notes.append(f"Left out (text with too many distinct values): {', '.join(map(str, skipped))}")
    facts: dict = {"source": src, "rows": len(df), "target": target, "identifiers": list(ids), "inputs": numeric + categorical, "how": how}
    if classify:
        models = {
            "most common class": lambda: DummyClassifier(strategy="most_frequent"),
            "logistic regression": lambda: make_pipeline(pre, LogisticRegression(max_iter=2000, class_weight="balanced")),
            "gbm": lambda: make_pipeline(pre, HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, class_weight="balanced", random_state=seed)),
        }
        rows, best, scores = [], ("", -1.0), {}
        for name, make in models.items():
            truth, pred = [], []
            for tr, te in splits:
                m = make().fit(X.iloc[tr], y.iloc[tr])
                truth += list(y.iloc[te])
                pred += list(m.predict(X.iloc[te]))
            bal = balanced_accuracy_score(truth, pred)
            scores[name] = {"accuracy": accuracy_score(truth, pred), "balanced_accuracy": bal, "macro_f1": f1_score(truth, pred, average="macro")}
            rows.append([name, f"{scores[name]['accuracy']:.0%}", f"{bal:.0%}", f"{scores[name]['macro_f1']:.2f}"])
            if name != "most common class" and bal > best[1]:
                best = (name, bal)
        base = scores["most common class"]["balanced_accuracy"]
        decision = f"Best: {best[0]}, balanced accuracy {best[1]:.0%} against {base:.0%} for always guessing the most common class."
        headers = ["Method", "Accuracy", "Balanced accuracy", "Macro F1"]
        facts.update(classes={str(k): int(v) for k, v in y.value_counts().items()}, best=best[0], scores=scores)
    else:
        yv = pd.to_numeric(y, errors="coerce").to_numpy(float)
        if not np.all(yv[np.isfinite(yv)] > 0):
            raise hist.HistoryError("Regression here expects a positive target (a duration, an effort, a cost).")
        models = {
            "ridge": lambda: make_pipeline(pre, Ridge(alpha=1.0)),
            "gbm": lambda: make_pipeline(pre, HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, random_state=seed)),
        }
        idx = np.concatenate([te for _, te in splits])
        preds = {"median": np.zeros(len(idx))}
        for n in models:
            preds[n] = np.zeros(len(idx))
        pos = 0
        for tr, te in splits:
            preds["median"][pos : pos + len(te)] = np.median(yv[tr])
            for n, make in models.items():
                preds[n][pos : pos + len(te)] = np.exp(make().fit(X.iloc[tr], np.log(yv[tr])).predict(X.iloc[te]))
            pos += len(te)
        rows, decision, best_name, metrics = _regression_summary(preds, yv[idx], "median")
        headers = ["Method", "Median miss", "Mean miss", "Typical miss", "Within ±25%", "Against the median"]
        facts.update(best=best_name, metrics=metrics)
    return Table(
        title=f"{'Classification' if classify else 'Regression'} of “{target}” on public data",
        licence=licence,
        setup=f"{len(df)} rows; {len(numeric)} numeric and {len(categorical)} categorical columns as inputs; {how}.",
        headers=headers,
        rows=rows,
        decision=decision,
        may_save=may_save,
        notes=notes,
        facts=facts,
    )


# ---------------------------------------------------------------- text (tickets)


def _normal(text: pd.Series) -> pd.Series:
    """Text compared the way a person would: case and runs of spaces ignored."""
    return text.fillna("").astype(str).str.casefold().str.replace(r"\s+", " ", regex=True).str.strip()


def ticket_texts(df: pd.DataFrame, text: str) -> pd.Series:
    """One text per row from one column, or several joined (``subject,body``)."""
    cols = [c.strip() for c in text.split(",") if c.strip()]
    absent = [c for c in cols if c not in df.columns]
    if absent:
        raise hist.HistoryError(f"there’s no column {', '.join(f'“{c}”' for c in absent)}. Columns: {', '.join(map(str, df.columns))}")
    joined = df[cols[0]].fillna("").astype(str)
    for c in cols[1:]:
        joined = joined + "\n" + df[c].fillna("").astype(str)
    return joined.str.strip()


def prepare_tickets(df: pd.DataFrame, text: str, label: str) -> tuple[pd.DataFrame, dict]:
    """Rows with a text and a label, each text once. The same text with different labels can't be
    learned from either way, so every copy of it goes; a text repeated with the same label is kept
    once, so it can't sit in training and test at the same time."""
    if label not in df.columns:
        raise hist.HistoryError(f"there’s no column “{label}”. Columns: {', '.join(map(str, df.columns))}")
    out = df.copy()
    out["_text"] = ticket_texts(out, text)
    out["_label"] = out[label].astype("string").str.strip()
    n0 = len(out)
    out = out[(out["_text"] != "") & out["_label"].notna() & (out["_label"] != "")]
    empty = n0 - len(out)
    out["_key"] = _normal(out["_text"])
    labels = out.groupby("_key")["_label"].nunique()
    conflicting = set(labels[labels > 1].index)
    conflict_rows = int(out["_key"].isin(conflicting).sum())
    out = out[~out["_key"].isin(conflicting)]
    dup = out["_key"].duplicated()
    duplicates = int(dup.sum())
    out = out[~dup].reset_index(drop=True)
    return out, {"rows_in_file": n0, "without_text_or_label": empty, "duplicates_removed": duplicates, "conflicting_rows_removed": conflict_rows, "rows": len(out)}


def overlap(a: pd.DataFrame, b_path: str | Path, text: str) -> int:
    """How many of ``a``'s texts also appear in another file (compared as :func:`_normal` does)."""
    other = pd.read_csv(b_path)
    try:
        keys = set(_normal(ticket_texts(other, text)))
    except hist.HistoryError:
        return 0
    return int(a["_key"].isin(keys).sum())


def tickets(
    path: str | Path,
    text: str,
    label: str,
    dataset: str = "support-tickets",
    seed: int = 7,
    max_rows: int = 50_000,
    by: str | None = "language",
    compare_with: list[str | Path] | None = None,
) -> Table:
    """Predicting a ticket's label (its priority, its queue) from its words, against always
    guessing the most common label. ``text`` may name several columns (``subject,body``). Files
    that are versions of one dataset share tickets, so each is measured on its own, never pooled:
    ``compare_with`` lists the others, and the report says how many tickets they share."""
    raw = pd.read_csv(path)
    df, prep = prepare_tickets(raw, text, label)
    if len(df) > max_rows:
        df = df.sample(max_rows, random_state=seed).reset_index(drop=True)
    X, y = df["_text"], df["_label"]
    models = {
        "most common label": lambda: DummyClassifier(strategy="most_frequent"),
        "words (tf-idf) + logistic regression": lambda: make_pipeline(
            TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=200_000, sublinear_tf=True), LogisticRegression(max_iter=2000, class_weight="balanced")
        ),
        "characters (tf-idf) + logistic regression": lambda: make_pipeline(
            TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=3, max_features=200_000, sublinear_tf=True), LogisticRegression(max_iter=2000, class_weight="balanced")
        ),
    }
    folds = list(StratifiedKFold(5, shuffle=True, random_state=seed).split(X, y))
    rows, best, scores, out_of_fold = [], ("", -1.0), {}, {}
    for name, make in models.items():
        pred = pd.Series(index=df.index, dtype=object)
        for tr, te in folds:
            m = make().fit(X.iloc[tr], y.iloc[tr])
            pred.iloc[te] = m.predict(X.iloc[te])
        bal = balanced_accuracy_score(y, pred.astype(str))
        scores[name] = {"accuracy": accuracy_score(y, pred.astype(str)), "balanced_accuracy": bal, "macro_f1": f1_score(y, pred.astype(str), average="macro")}
        out_of_fold[name] = pred.astype(str)
        rows.append([name, f"{scores[name]['accuracy']:.0%}", f"{bal:.0%}", f"{scores[name]['macro_f1']:.2f}"])
        if not name.startswith("most") and bal > best[1]:
            best = (name, bal)
    licence, may_save = licence_note(dataset)
    src = source(path)
    notes = [source_line(src)]
    cleaned = []
    if prep["without_text_or_label"]:
        cleaned.append(f"{prep['without_text_or_label']} without a text or a label")
    if prep["duplicates_removed"]:
        cleaned.append(f"{prep['duplicates_removed']} repeating a text already in the file (case and spacing ignored)")
    if prep["conflicting_rows_removed"]:
        cleaned.append(f"{prep['conflicting_rows_removed']} whose text appears with different labels")
    notes.append(f"{prep['rows_in_file']:,} rows in the file; " + (f"removed {', '.join(cleaned)}; " if cleaned else "nothing removed; ") + f"{prep['rows']:,} measured.")
    facts: dict = {"source": src, **prep, "measured": len(df), "labels": {str(k): int(v) for k, v in y.value_counts().items()}, "text": text, "label": label, "best": best[0], "scores": scores}
    if by and by in df.columns and best[0]:
        groups = {}
        for g, part in df.groupby(by):
            if len(part) >= 30 and part["_label"].nunique() > 1:
                groups[str(g)] = {"rows": len(part), "balanced_accuracy": balanced_accuracy_score(part["_label"], out_of_fold[best[0]].loc[part.index])}
        if groups:
            notes.append(f"By {by} ({best[0]}): " + ", ".join(f"{g} {v['balanced_accuracy']:.0%} of {v['rows']:,}" for g, v in groups.items()) + ".")
            facts["by"] = {by: groups}
    shared = {}
    for other in compare_with or []:
        if Path(other).resolve() == Path(path).resolve():
            continue
        n = overlap(df, other, text)
        shared[Path(other).name] = n
        if n:
            notes.append(f"{n:,} of these tickets ({n / len(df):.0%}) also appear in {Path(other).name}: the files are versions of one dataset, so each is measured on its own, never pooled.")
    if shared:
        facts["shared_with"] = shared
    return Table(
        title=f"Predicting “{label}” from “{text}”",
        licence=licence,
        setup=f"{len(df):,} texts, {y.nunique()} labels, 5-fold stratified cross-validation. Character n-grams work across languages without a tokenizer.",
        headers=["Method", "Accuracy", "Balanced accuracy", "Macro F1"],
        rows=rows,
        decision=f"Best: {best[0]}, balanced accuracy {best[1]:.0%} against {scores['most common label']['balanced_accuracy']:.0%} for always guessing the most common label."
        + ("" if may_save else " The data’s licence doesn’t allow commercial use, so no model is saved: this measures what’s possible, nothing more."),
        may_save=may_save,
        notes=notes,
        facts=facts,
    )
