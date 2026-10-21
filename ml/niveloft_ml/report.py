"""The report: what was compared, on what, and the decision, as Markdown and JSON."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .evaluate import Outcome

SYNTHETIC_BANNER = (
    "> **Synthetic data.** These tasks were made up by `python -m niveloft_ml synthetic`. The numbers describe that generator, "
    "not any real team: use them to see how the kit works, never to judge a forecast."
)


def _row(s) -> str:
    gain = "" if s.gain is None else f"{s.gain:+.0%} ({s.gain_range[0]:+.0%} to {s.gain_range[1]:+.0%}), ahead in {s.ahead_in:.0%}"
    return f"| {s.description} | {s.median_error_days:.2f} | {s.mean_error_days:.2f} | ×{s.typical_miss:.2f} | {s.within_25_percent:.0%} | {gain} |"


def markdown(out: Outcome, title: str = "Deadline forecast: does a model beat Niveloft’s own?") -> str:
    d = out.data
    lines = [f"# {title}", ""]
    if d.get("synthetic"):
        lines += [SYNTHETIC_BANNER, ""]
    lines += [
        f"Made {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC from {', '.join(Path(f).name for f in d.get('files', []))}.",
        "",
        "## The decision",
        "",
        out.decision["why"],
        "",
        "## The data",
        "",
        f"- Projects: {', '.join(d.get('projects', [])) or 'none'}; {d.get('tasks', 0)} tasks, {d.get('people', 0)} people (as p1, p2, …).",
        f"- Approved tasks with a start date: {d.get('finished_with_start', 0)}"
        + (f"; {d['estimated_share']:.0%} of them had an estimate." if "estimated_share" in d else "."),
    ]
    if d.get("cutoff"):
        lines.append(
            f"- Trained on the {d['train']} tasks approved by {d['cutoff'][:10]}; tested on the {d['test']} that started after it"
            + (f" ({d['in_flight_at_cutoff']} in progress on that day were left out of both)." if d.get("in_flight_at_cutoff") else ".")
        )
    lines += ["", "What’s predicted: the working days from when a task could proceed (started, and everything it waited on approved) to its final submission for review, the same quantity Niveloft’s forecast predicts. Review waits are separate.", ""]
    if out.scores:
        lines += [
            "## How each did on the later tasks",
            "",
            "| Method | Median miss (days) | Mean miss (days) | Typical miss | Within ±25% | Against Niveloft’s forecast |",
            "|---|---:|---:|---:|---:|---|",
            *[_row(s) for s in out.scores],
            "",
            "*Typical miss* is how far off a typical forecast was, as a factor: ×1.30 means 30% too long or too short. "
            "*Against Niveloft’s forecast* is the share of its typical miss a model removed (with a 90% range from resampling the test tasks), "
            "and how often it came out ahead across those resamples.",
            "",
        ]
    if "niveloft_vs_plan" in d:
        v = d["niveloft_vs_plan"]
        lines += [f"Niveloft’s forecast against the estimates as written: {v['gain']:+.0%} of their typical miss removed, ahead in {v['ahead_in']:.0%} of resamples.", ""]
    if out.niveloft_range_coverage is not None:
        lines += [
            f"Niveloft’s 80% range (the p10 to p90 band it shows) held {out.niveloft_range_coverage:.0%} of the actual times on these tasks. "
            + ("That’s about right." if 0.72 <= out.niveloft_range_coverage <= 0.88 else "Far from 80% means its ranges are too narrow or too wide for this team."),
            "",
        ]
    lines += [
        "## What this can’t tell you",
        "",
        "- Why a task took as long as it did. This compares forecasts; it doesn’t explain them.",
        "- Anything about people: p1, p2, … are pseudonyms in one file and change between downloads. Pace is used only to forecast a person’s own work, never to rank anyone.",
        "- How it would do on a different team or kind of work. Retest when the team or the work changes.",
        "",
    ]
    if out.notes:
        lines += ["## Notes", "", *[f"- {n}" for n in out.notes], ""]
    return "\n".join(lines)


TRIAL_HELP = (
    "## Trying it in Niveloft\n\n"
    "`model.json` is this model in a form Niveloft's server runs (no Python there). Copy it to the server and set "
    "`FORECAST_MODEL_FILE` to its path. Members then see its forecast for work in progress beside Niveloft's own, on the "
    "Delivery page; the server records both forecasts the first time it makes them, and how each did once the work is "
    "submitted. Niveloft's forecast stays the one the app uses: the model is only compared. To stop the trial, switch off "
    "*Forecast model trial* in Site health (or remove the setting); nothing else changes.\n"
)


def write(out: Outcome, folder: str | Path, fitted: dict | None, can_save_model: bool = True, title: str | None = None, portable: bool = True) -> list[Path]:
    """Writes report.md and report.json, and when a model is recommended and may be kept,
    model.joblib (for Python) and model.json (for Niveloft's server, when the model is portable)."""
    from . import export

    path = Path(folder)
    path.mkdir(parents=True, exist_ok=True)
    files = []
    model_files = []
    trial = False
    if fitted and can_save_model:
        import joblib

        target = path / "model.joblib"
        joblib.dump(
            {
                "model": fitted["model"],
                "features": fitted["features"],
                "predicts": "log working days from when a task could proceed to its final submission",
                "decision": out.decision,
                "data": {k: v for k, v in out.data.items() if k != "files"},
                "made": datetime.now(timezone.utc).isoformat(),
            },
            target,
        )
        model_files.append(target)
        if portable and "name" in fitted:
            try:
                doc = export.document(fitted["name"], fitted["description"], fitted["model"], fitted["features"], out.data, out.decision, fitted.get("through"))
                export.write(doc, path / "model.json")
                model_files.append(path / "model.json")
                trial = True
            except export.NotPortable as e:
                out.notes.append(f"This model can’t run on Niveloft’s server as it is ({e}), so there’s no model.json; model.joblib is for Python.")
    md = path / "report.md"
    text = markdown(out, **({"title": title} if title else {}))
    if trial:
        text += "\n" + TRIAL_HELP
    md.write_text(text, encoding="utf-8")
    files.append(md)
    js = path / "report.json"
    js.write_text(json.dumps(out.to_dict(), indent=2, default=str), encoding="utf-8")
    files.append(js)
    return files + model_files
