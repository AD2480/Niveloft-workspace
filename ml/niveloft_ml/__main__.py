"""python -m niveloft_ml — see ml/README.md.

  train      compare models with Niveloft's forecast on your own task history
  synthetic  write a made-up history (project SYN) to try the kit with
  public     first experiments on public data: jira, effort, tabular, tickets, or all of them
             from one folder of downloads (writes SUMMARY.md)
  xlam       check every record of the xLAM data and draw the fixed evaluation sample
  tools      measure a model on Flurry's tools (or the xLAM sample) before any fine-tuning
  sft        xLAM examples as training conversations, for after an eval shows a gap
  datasets   the public datasets, with their licences
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

from . import arff, evaluate, history, models, public, report, summary, synthetic, tooleval, xlam


def _train(a: argparse.Namespace) -> int:
    h = history.read(a.data)
    cands, notes = models.candidates([x for x in (a.with_ or "").split(",") if x], seed=a.seed)
    s = evaluate.Settings(test_share=a.test_share, min_train=a.min_train, min_test=a.min_test, min_gain=a.min_gain, seed=a.seed)
    out, fitted = evaluate.run(h, cands, s)
    out.notes = notes + out.notes
    files = report.write(out, a.out, fitted, can_save_model=not a.no_model, title=a.title)
    print(out.decision["why"])
    print("\n".join(f"  wrote {f}" for f in files))
    return 0


def _jira(a: argparse.Namespace) -> int:
    mapping = json.loads(Path(a.mapping).read_text(encoding="utf-8"))
    converted = public.jira(a.data, mapping)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "jira-as-niveloft.csv"
        converted.to_csv(path, index=False)
        h = history.read([path])
        h = history.History(h.tasks, [str(a.data)])
        licence, may_save = public.licence_note(a.dataset)
        cands, notes = models.candidates([x for x in (a.with_ or "").split(",") if x], seed=a.seed)
        s = evaluate.Settings(test_share=a.test_share, min_train=a.min_train, min_test=a.min_test, seed=a.seed)
        out, fitted = evaluate.run(h, cands, s)
        out.notes = [licence, "Jira has no start or review dates, so the time compared is created → resolved, queue time included."] + notes + out.notes
        # A model of created → resolved on someone else's Jira isn't Niveloft's forecast: no model.json.
        files = report.write(out, a.out, fitted, can_save_model=may_save and not a.no_model, title="Task duration on public data (a Jira export)", portable=False)
    print(out.decision["why"])
    print("\n".join(f"  wrote {f}" for f in files))
    return 0


def _tools(a: argparse.Namespace) -> int:
    key = tooleval.api_key_from(a.api_key_env)
    client = tooleval.Client(a.base_url, a.model, key, timeout=a.timeout)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if a.xlam:
        rows, how = xlam.load_sample(a.xlam, a.sample, a.seed)
        result = tooleval.run_xlam(client, rows)
        result["sample"] = how
        (out / "xlam.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"xLAM, {how}: {result['exact']:.0%} exactly right, {result['names']:.0%} right functions" + (f", {result['errors']} API errors" if result["errors"] else ""))
        print(f"  wrote {out / 'xlam.json'}")
        return 0
    run = tooleval.run_cases(client, tooleval.load_cases(only=[x for x in a.only.split(",") if x] or None), Path(a.tools) if a.tools else tooleval.TOOLS)
    (out / "results.md").write_text(tooleval.markdown(run), encoding="utf-8")
    (out / "results.json").write_text(json.dumps(tooleval.to_dict(run), indent=2, ensure_ascii=False), encoding="utf-8")
    s = run.summary()
    print(f"{s['passed']} of {s['total']} cases passed" + (f" ({s['errors']} API errors)" if s["errors"] else ""))
    print(f"  wrote {out / 'results.md'}\n  wrote {out / 'results.json'}")
    return 0 if s["passed"] == s["total"] else 1


def _sft(a: argparse.Namespace) -> int:
    rows = tooleval.xlam_to_sft(tooleval.load_xlam(a.xlam, a.sample, a.seed))
    with Path(a.out).open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} conversations to {a.out}. {public.licence_note('xlam-function-calling-60k')[0]}")
    return 0


def _tickets(a: argparse.Namespace) -> int:
    paths = list(a.data)
    for i, path in enumerate(paths):
        t = public.tickets(path, a.text, a.label, a.dataset, by=a.by or None, compare_with=[p for p in paths if p != path])
        _table(t, a.out if len(paths) == 1 else str(Path(a.out) / Path(path).stem))
    return 0


def _xlam(a: argparse.Namespace) -> int:
    rows = xlam.read(a.data)
    result = xlam.check(rows)
    sample = xlam.fixed_sample(rows, result["usable_ids"], a.sample, a.seed)
    doc = xlam.sample_document(a.data, rows, result, sample)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "check.md").write_text(xlam.markdown(a.data, result, sample), encoding="utf-8")
    (out / "check.json").write_text(json.dumps({k: v for k, v in result.items() if k != "usable_ids"} | {"source": doc["source"]}, indent=2), encoding="utf-8")
    (out / "sample.json").write_text(json.dumps(doc, indent=2), encoding="utf-8")
    print(f"{result['usable']:,} of {result['records']:,} records can be scored; fixed sample of {sample['size']}: " + ", ".join(f"{v} {s}" for s, v in sample["strata"].items()))
    print("\n".join(f"  wrote {out / f}" for f in ("check.md", "check.json", "sample.json")))
    if a.write_sample:
        xlam.SAMPLE_FILE.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        print(f"  wrote {xlam.SAMPLE_FILE}")
    return 0


def _all(a: argparse.Namespace) -> int:
    path = summary.run_all(a.dir, a.out, a.risk_target, a.write_sample, a.reuse)
    print(f"wrote {path}")
    return 0


def _table(t: public.Table, out: str) -> int:
    files = t.write(out)
    print(t.decision)
    print("\n".join(f"  wrote {f}" for f in files))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m niveloft_ml", description="Deadline forecasts trained on your own task history, tested against Niveloft’s.")
    sub = p.add_subparsers(dest="command", required=True)

    t = sub.add_parser("train", help="Compare models with Niveloft’s forecast on your task history")
    t.add_argument("--data", action="append", required=True, help="A task-history CSV (repeat for several projects)")
    t.add_argument("--out", default="ml-report", help="Folder for report.md, report.json and (if recommended) model.joblib")
    t.add_argument("--with", dest="with_", default="", help="Optional models, comma-separated: xgboost, autogluon")
    t.add_argument("--test-share", type=float, default=0.25)
    t.add_argument("--min-train", type=int, default=60)
    t.add_argument("--min-test", type=int, default=30)
    t.add_argument("--min-gain", type=float, default=0.05)
    t.add_argument("--seed", type=int, default=7)
    t.add_argument("--no-model", action="store_true", help="Write the report only, never a model file")
    t.add_argument("--title", default=None)
    t.set_defaults(run=_train)

    g = sub.add_parser("synthetic", help="Write a made-up task history (project SYN)")
    g.add_argument("--out", default="SYN-task-history-v1.csv")
    g.add_argument("--tasks", type=int, default=1200)
    g.add_argument("--people", type=int, default=8)
    g.add_argument("--seed", type=int, default=7)
    g.add_argument("--plain", action="store_true", help="Only what Niveloft’s forecast models (estimate × pace × noise)")
    g.set_defaults(run=lambda a: print(f"wrote {synthetic.write(a.out, tasks=a.tasks, people=a.people, seed=a.seed, plain=a.plain)} (synthetic)") or 0)

    pub = sub.add_parser("public", help="First experiments on public data")
    psub = pub.add_subparsers(dest="kind", required=True)
    j = psub.add_parser("jira", help="A Jira issues export, through a column mapping")
    j.add_argument("--data", required=True)
    j.add_argument("--mapping", default=str(Path(__file__).resolve().parent.parent / "examples" / "jira-mapping.json"))
    j.add_argument("--dataset", default="apache-jira")
    j.add_argument("--out", default="ml-report-jira")
    j.add_argument("--with", dest="with_", default="")
    j.add_argument("--test-share", type=float, default=0.25)
    j.add_argument("--min-train", type=int, default=60)
    j.add_argument("--min-test", type=int, default=30)
    j.add_argument("--seed", type=int, default=7)
    j.add_argument("--no-model", action="store_true")
    j.set_defaults(run=_jira)
    e = psub.add_parser("effort", help="Whole-project effort (the Desharnais data, .arff or .csv)")
    e.add_argument("--data", required=True)
    e.add_argument("--out", default="ml-report-effort")
    e.set_defaults(run=lambda a: _table(public.effort(a.data), a.out))
    tb = psub.add_parser("tabular", help="Any table with a target column")
    tb.add_argument("--data", required=True)
    tb.add_argument("--target", required=True)
    tb.add_argument("--classify", action="store_true")
    tb.add_argument("--time-col", default=None)
    tb.add_argument("--drop", default="", help="Columns to leave out, comma-separated (ids, outcomes)")
    tb.add_argument("--keep", default="", help="Columns that look like identifiers but should stay, comma-separated")
    tb.add_argument("--dataset", default=None, help="Its name in datasets.json, for the licence")
    tb.add_argument("--out", default="ml-report-tabular")
    tb.set_defaults(run=lambda a: _table(public.tabular(a.data, a.target, a.classify, a.time_col, [c for c in a.drop.split(",") if c], a.dataset, keep=[c for c in a.keep.split(",") if c]), a.out))
    tk = psub.add_parser("tickets", help="Text classification (for example a ticket’s priority)")
    tk.add_argument("--data", action="append", required=True, help="A CSV; repeat for versions of the same dataset (each is measured on its own, never pooled)")
    tk.add_argument("--text", required=True, help="The text column, or several joined: subject,body")
    tk.add_argument("--label", required=True)
    tk.add_argument("--by", default="language", help="A column to break the best result down by (empty for none)")
    tk.add_argument("--dataset", default="support-tickets")
    tk.add_argument("--out", default="ml-report-tickets")
    tk.set_defaults(run=_tickets)
    al = psub.add_parser("all", help="Everything that applies to the files in one folder, with SUMMARY.md")
    al.add_argument("--dir", required=True, help="The folder with the downloads (Desharnais .arff, the ticket CSVs, the xLAM .json, a risk CSV)")
    al.add_argument("--out", default="ml-report-public")
    al.add_argument("--risk-target", default=None, help="The column the risk CSV should predict")
    al.add_argument("--write-sample", action="store_true", help="Also update eval_cases/xlam-sample.json from this xLAM file")
    al.add_argument("--reuse", action="store_true", help="Read back reports already in --out for the same files (same SHA-256) instead of rerunning them")
    al.set_defaults(run=_all)

    xl = sub.add_parser("xlam", help="Check every xLAM record and draw the fixed evaluation sample")
    xl.add_argument("--data", required=True, help="xlam_function_calling_60k.json, as downloaded")
    xl.add_argument("--out", default="ml-report-xlam")
    xl.add_argument("--sample", type=int, default=200)
    xl.add_argument("--seed", type=int, default=7)
    xl.add_argument("--write-sample", action="store_true", help="Update eval_cases/xlam-sample.json (ids and the file's SHA-256, no records)")
    xl.set_defaults(run=_xlam)

    tl = sub.add_parser("tools", help="Measure a model on Flurry’s tools (or on an xLAM sample)")
    tl.add_argument("--base-url", required=True, help="An OpenAI-compatible API, for example http://localhost:11434/v1 (Ollama) or http://localhost:8000/v1 (vLLM)")
    tl.add_argument("--model", required=True)
    tl.add_argument("--api-key-env", default="AI_API_KEY", help="The environment variable holding the API key (never the key itself)")
    tl.add_argument("--only", default="", help="Case ids or kinds, comma-separated (lookup, no-lookup, proposal, safety, honesty)")
    tl.add_argument("--tools", default=None, help="Another tools.json (default: the server's)")
    tl.add_argument("--xlam", default=None, help="Score the xLAM sample instead (your download; the fixed 200 when its SHA-256 matches, a seeded sample otherwise)")
    tl.add_argument("--sample", type=int, default=200)
    tl.add_argument("--seed", type=int, default=7)
    tl.add_argument("--timeout", type=float, default=120.0)
    tl.add_argument("--out", default="ml-report-tools")
    tl.set_defaults(run=_tools)

    sf = sub.add_parser("sft", help="xLAM examples as tool-calling conversations for TRL's SFTTrainer (only after an eval shows a gap)")
    sf.add_argument("--xlam", required=True)
    sf.add_argument("--out", default="xlam-sft.jsonl")
    sf.add_argument("--sample", type=int, default=60000)
    sf.add_argument("--seed", type=int, default=7)
    sf.set_defaults(run=_sft)

    d = sub.add_parser("datasets", help="The public datasets and their licences")
    d.set_defaults(run=lambda a: print("\n\n".join(f"{k}: {v['name']}\n  licence: {v['licence']}\n  commercial use: {v['commercial_use']}\n  use: {v['use']}\n  caution: {v['caution']}" for k, v in public.registry().items())) or 0)

    a = p.parse_args(argv)
    try:
        return int(a.run(a) or 0)
    except (history.HistoryError, tooleval.ApiError, xlam.XlamError, arff.ArffError, FileNotFoundError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
