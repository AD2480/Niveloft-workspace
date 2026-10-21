"""Every public experiment in one run, from one folder of downloads, with one SUMMARY.md.

    python -m niveloft_ml public all --dir ~/Downloads/niveloft-data --out results/public

It finds the files by their names and columns, runs what it can, says what it couldn't and why,
and records each source's size and SHA-256 so a rerun can be checked against the same downloads.
Nothing here measures Flurry's conversations or Niveloft's own deadline forecast: those need the
tool-calling eval against a live model, and your own exported history.
"""

from __future__ import annotations

import datetime as dt
import json
import platform
from pathlib import Path

import pandas as pd

from . import history as hist
from . import public, xlam

TICKET_FILES = {
    # The creator's newest release: English and German, with a version column. The main benchmark.
    "aa_dataset-tickets-multi-lang-5-2-50-version.csv": "the newest release, 5.2, in English and German",
    "dataset-tickets-multi-lang-4-20k.csv": "an earlier release of 20,000 tickets",
    "dataset-tickets-german_normalized_50_5_2.csv": "a German-only release with five priority levels",
}

#: What was seen in a particular file that changes how its score should be read.
TICKET_CAUTIONS = {
    "dataset-tickets-german_normalized_50_5_2.csv": (
        "Read this score with care: these synthetic texts often state the urgency in words (dringend, kritisch, sofort appear mostly in high and critical tickets), "
        "which the generator wrote to match the label. The score shows the generator was consistent, not that real tickets are this predictable."
    ),
}


def _reused(folder: Path, path: Path, dataset: str) -> public.Table | None:
    """A report already written for this exact file (same SHA-256), to skip a long rerun. Its
    licence line is rewritten from datasets.json, which may have been updated since."""
    f = folder / "report.json"
    if not f.exists():
        return None
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        if data.get("facts", {}).get("source", {}).get("sha256") != public.sha256(path):
            return None
        t = public.Table(**data)
        t.licence = public.licence_note(dataset)[0]
        return t
    except (ValueError, TypeError, KeyError):
        return None


def _columns(path: Path) -> list[str]:
    try:
        return [str(c) for c in pd.read_csv(path, nrows=0).columns]
    except Exception:  # noqa: BLE001 - an unreadable file is reported as skipped
        return []


def find(folder: Path) -> dict[str, list[Path]]:
    files = sorted(p for p in folder.iterdir() if p.is_file())
    found: dict[str, list[Path]] = {"effort": [], "tickets": [], "xlam": [], "risk": [], "jira": []}
    for p in files:
        name = p.name.lower()
        if "desharnais" in name and p.suffix.lower() in (".arff", ".csv"):
            found["effort"].append(p)
        elif "xlam" in name and p.suffix.lower() in (".json", ".jsonl"):
            found["xlam"].append(p)
        elif p.suffix.lower() == ".csv":
            cols = {c.lower() for c in _columns(p)}
            if {"body", "priority"} <= cols:
                found["tickets"].append(p)
            elif "risk" in name:
                found["risk"].append(p)
            elif "jira" in name or {"key", "created", "resolutiondate"} <= cols:
                found["jira"].append(p)
    # The newest ticket release first: it's the main benchmark.
    order = list(TICKET_FILES)
    found["tickets"].sort(key=lambda p: (order.index(p.name) if p.name in order else len(order), p.name))
    return found


def _pct(x: float) -> str:
    return f"{x:.0%}"


def run_all(folder: str | Path, out: str | Path, risk_target: str | None = None, write_sample: bool = False, reuse: bool = False) -> Path:
    """Runs everything that applies. With ``reuse``, a report already in ``out`` for the same file
    (same SHA-256) is read back instead of rerun: the ticket models take minutes."""
    folder, out = Path(folder), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    found = find(folder)
    sources: list[dict] = []
    sections: list[str] = []
    skipped: list[str] = []
    results: dict = {}

    # ------------------------------------------------------------ xLAM
    for p in found["xlam"][:1]:
        rows = xlam.read(p)
        check = xlam.check(rows)
        sample = xlam.fixed_sample(rows, check["usable_ids"])
        doc = xlam.sample_document(p, rows, check, sample)
        (out / "xlam").mkdir(exist_ok=True)
        (out / "xlam" / "check.md").write_text(xlam.markdown(p, check, sample), encoding="utf-8")
        (out / "xlam" / "check.json").write_text(json.dumps({k: v for k, v in check.items() if k != "usable_ids"} | {"source": doc["source"]}, indent=2), encoding="utf-8")
        (out / "xlam" / "sample.json").write_text(json.dumps(doc, indent=2), encoding="utf-8")
        if write_sample:
            xlam.SAMPLE_FILE.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        sources.append({"file": p.name, "bytes": p.stat().st_size, "sha256": doc["source"]["sha256"], "rows": len(rows), "used_for": "tool-calling sample"})
        issues = "; ".join(f"{v:,} where {xlam.ISSUES[k].removeprefix('it ').removeprefix('its ')}" for k, v in check["issues"].items() if v)
        sections.append(
            "## xLAM Function Calling 60K\n\n"
            f"Every record was read and checked: **{check['usable']:,} of {check['records']:,} can be scored**. "
            f"The rest have problems a scorer can't settle ({issues}; a record can have more than one). "
            f"A fixed sample of {sample['size']} usable records ({', '.join(f'{v} {s}' for s, v in sample['strata'].items())}) is stored as ids and the file's SHA-256 in `ml/eval_cases/xlam-sample.json`; "
            "`python -m niveloft_ml tools --xlam <your download>` scores exactly those records when the hash matches.\n\n"
            "What it means: a model's general function calling can be measured before any fine-tuning. Flurry hasn't been trained on these records, and nothing here says how well Flurry answers questions about a project. "
            "[Report](xlam/check.md)\n"
        )
        results["xlam"] = {k: v for k, v in check.items() if k != "usable_ids"} | {"sample": sample["strata"]}

    # ------------------------------------------------------------ Desharnais
    for p in found["effort"][:1]:
        t = (reuse and _reused(out / "effort", p, "desharnais")) or public.effort(p)
        t.write(out / "effort")
        f = t.facts
        best, m = f["best"], f["metrics"]
        sources.append({"file": p.name, "bytes": f["source"]["bytes"], "sha256": f["source"]["sha256"], "rows": f["rows_in_file"], "used_for": "effort estimation"})
        cc = f.get("complete_cases")
        sections.append(
            "## Desharnais software effort\n\n"
            f"{f['projects']} projects, read from the PROMISE ARFF file. Inputs are only what's known when a project is estimated ({', '.join(f['inputs'])}); "
            f"{', '.join(f['excluded'])} are never inputs (an identifier, the actual schedule, the end year). "
            f"The file's -1 markers became missing values in {f['incomplete_projects']} projects, filled inside each training fold.\n\n"
            f"Typical miss (geometric mean of actual ÷ predicted, either way): function-point regression ×{m['function points']['typical_miss']:.2f}, "
            f"best model {best} ×{m[best]['typical_miss']:.2f}. {t.decision.split(' This is research')[0]}"
            + (f" On the {cc['projects']} complete projects alone: best {cc['best']} ×{cc['metrics'][cc['best']]['typical_miss']:.2f} against ×{cc['metrics']['function points']['typical_miss']:.2f}." if cc else "")
            + "\n\nWhat it means: a comparison of methods on whole projects from the 1980s, free of the schedule-length leak. It isn't Niveloft's task forecast. [Report](effort/report.md)\n"
        )
        results["effort"] = f

    # ------------------------------------------------------------ tickets
    if found["tickets"]:
        parts = []
        for i, p in enumerate(found["tickets"]):
            sub = "tickets-" + p.stem.replace("dataset-tickets-", "").replace("aa_", "")
            t = (reuse and _reused(out / sub, p, "support-tickets")) or public.tickets(p, "subject,body", "priority", compare_with=[q for q in found["tickets"] if q != p])
            t.write(out / sub)
            f = t.facts
            sources.append({"file": p.name, "bytes": f["source"]["bytes"], "sha256": f["source"]["sha256"], "rows": f["rows_in_file"], "used_for": "ticket priority"})
            best = f["best"]
            s = f["scores"][best]
            base = f["scores"]["most common label"]["balanced_accuracy"]
            by = f.get("by", {}).get("language", {})
            shared = {k: v for k, v in (f.get("shared_with") or {}).items() if v}
            conflicting = f["conflicting_rows_removed"]
            dups = f["duplicates_removed"]
            removed = (f"{dups} repeated {'text' if dups == 1 else 'texts'}" if dups else "") + (f"{' and ' if dups else ''}{conflicting} with conflicting labels" if conflicting else "")
            parts.append(
                f"- **{p.name}**, {TICKET_FILES.get(p.name, 'a ticket file')}: {f['rows']:,} tickets " + (f"after removing {removed}" if removed else "(none repeated)") + "; "
                f"{len(f['labels'])} priority levels. Best: {best}, **balanced accuracy {_pct(s['balanced_accuracy'])}** (accuracy {_pct(s['accuracy'])}, macro F1 {s['macro_f1']:.2f}) "
                f"against {_pct(base)} for always guessing the most common level"
                + ("; by language " + ", ".join(g + " " + _pct(v["balanced_accuracy"]) for g, v in by.items()) if by else "")
                + "."
                + (f" Shares {', '.join(f'{v:,} tickets with {k}' for k, v in shared.items())}, so it was measured on its own." if shared else "")
                + (f" {TICKET_CAUTIONS[p.name]}" if p.name in TICKET_CAUTIONS else "")
                + f" [Report]({sub}/report.md)"
            )
            results[sub] = f
        sections.append(
            "## Multilingual customer support tickets\n\n"
            "Priority predicted from the subject and body, by 5-fold stratified cross-validation. Each file is a version of one dataset and they share tickets, so each is measured on its own and never pooled (pooling would put the same ticket in training and test).\n\n"
            + "\n".join(parts)
            + "\n\nWhat it means: a reproducible priority-classification benchmark on synthetic tickets. The licence is CC-BY-NC-4.0, so no model trained on it is saved or shipped. It isn't a measure of anything in Niveloft.\n"
        )

    # ------------------------------------------------------------ project risk
    for p in found["risk"][:1]:
        if not risk_target:
            skipped.append(f"{p.name}: found, but no `--risk-target` was given (the column to predict). Look at the file and rerun with it.")
            continue
        try:
            t = public.tabular(p, risk_target, classify=True, dataset="pm-risk-raw")
        except hist.HistoryError as e:
            skipped.append(f"{p.name}: {e}")
            continue
        t.write(out / "risk")
        f = t.facts
        sources.append({"file": p.name, "bytes": f["source"]["bytes"], "sha256": f["source"]["sha256"], "rows": f["rows"], "used_for": "project risk"})
        s = f["scores"][f["best"]]
        sections.append(
            "## Project management risk\n\n"
            f"{f['rows']:,} projects, predicting {risk_target}. Left out as identifiers: {', '.join(map(str, f['identifiers'])) or 'none found'}. "
            f"Best: {f['best']}, **balanced accuracy {_pct(s['balanced_accuracy'])}** against {_pct(f['scores']['most common class']['balanced_accuracy'])} for the most common class. [Report](risk/report.md)\n\n"
            "What it means: an initial risk-classification benchmark on a public table, not a measure of Niveloft's projects. Its licence wasn't checked here.\n"
        )
        results["risk"] = f
    if not found["risk"]:
        skipped.append("Project Management Risk Raw: no file with “risk” in its name in this folder, so it wasn't run. Add it and rerun with `--risk-target <column>`.")
    if not found["effort"]:
        skipped.append("Desharnais: no desharnais .arff or .csv in this folder.")
    if not found["xlam"]:
        skipped.append("xLAM: no xlam .json or .jsonl in this folder.")
    if not found["tickets"]:
        skipped.append("Support tickets: no CSV with body and priority columns in this folder.")
    for p in found["jira"]:
        skipped.append(f"{p.name}: Jira exports need a column mapping; run `python -m niveloft_ml public jira --data {p.name} --mapping <mapping.json>` yourself.")

    versions = {"python": platform.python_version()}
    for mod in ("numpy", "pandas", "sklearn"):
        try:
            versions[mod] = __import__(mod).__version__
        except ImportError:  # pragma: no cover
            versions[mod] = "not installed"
    when = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Public-data experiments: summary",
        "",
        f"Run {when} with Python {versions['python']}, NumPy {versions['numpy']}, pandas {versions['pandas']} and scikit-learn {versions['sklearn']}. "
        f"Rerun: `python -m niveloft_ml public all --dir <the folder with these files> --out <folder>`.",
        "",
        "These numbers measure classification and estimation on the supplied public datasets. They don't measure Flurry's conversational accuracy, and they don't measure Niveloft's deadline forecast: the first needs the tool-calling eval against a live model, the second your own exported history.",
        "",
        "## Sources",
        "",
        "| File | Size | Rows | Used for | SHA-256 |",
        "|---|---:|---:|---|---|",
        *[f"| {s['file']} | {s['bytes']:,} | {s['rows']:,} | {s['used_for']} | `{s['sha256']}` |" for s in sources],
        "",
        *sections,
    ]
    if skipped:
        lines += ["## Not run", "", *[f"- {s}" for s in skipped], ""]
    lines += [
        "## Licences",
        "",
        "- Support tickets: CC-BY-NC-4.0 (the creator's current Hugging Face release). Experiments only; don't assume commercial training is allowed.",
        "- xLAM Function Calling 60K: CC-BY-4.0, after accepting the dataset's access conditions on Hugging Face. The records aren't copied into this repository.",
        "- Desharnais (PROMISE repository) and Project Management Risk Raw: licences not checked here; read the sources before any use beyond research.",
        "",
    ]
    (out / "SUMMARY.md").write_text("\n".join(lines), encoding="utf-8")
    (out / "summary.json").write_text(json.dumps({"run": when, "versions": versions, "sources": sources, "results": results, "not_run": skipped}, indent=2, default=str), encoding="utf-8")
    return out / "SUMMARY.md"
