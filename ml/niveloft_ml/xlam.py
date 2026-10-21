"""Salesforce's xLAM function-calling data: every record checked, and a fixed evaluation sample.

Measurement comes before any training. ``check`` reads every record and says which ones can be
scored: the expected calls use functions the record offers, with arguments those functions
declare, the required ones present, and values of the declared kinds. ``fixed_sample`` then picks
a stratified set of the usable records by id, the same set every time.

The sample is kept as ids plus the file's SHA-256, never as records. The dataset's access
conditions are accepted per person on Hugging Face, so each person scores a model against their
own download, and the hash proves it's the same file the sample was drawn from.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from collections import Counter
from pathlib import Path
from typing import Any

SAMPLE_FILE = Path(__file__).resolve().parent.parent / "eval_cases" / "xlam-sample.json"

ISSUES = {
    "bad_json": "its tools or answers aren't valid JSON",
    "no_query": "it has no question",
    "bad_tools": "a tool has no name, or its parameters aren't described",
    "duplicate_tool": "two tools share a name",
    "no_answers": "it has no expected call",
    "bad_answer": "an expected call has no name, or its arguments aren't an object",
    "unknown_function": "an expected call uses a function the record doesn't offer",
    "unknown_argument": "an expected call passes an argument the function doesn't declare",
    "missing_required": "an expected call leaves out a required argument",
    "wrong_type": "an expected value isn't of the declared kind",
}

#: How a record's expected calls are shaped, as in APIGen's own categories.
STRATA = ("simple", "multiple", "parallel", "parallel multiple")


class XlamError(ValueError):
    pass


def sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read(path: str | Path) -> list[dict]:
    """The records of a .json (one list) or .jsonl (one record per line) download."""
    text = Path(path).read_text(encoding="utf-8").strip()
    try:
        rows = json.loads(text) if text.startswith("[") else [json.loads(line) for line in text.splitlines() if line.strip()]
    except json.JSONDecodeError as e:
        raise XlamError(f"{path} isn’t JSON or JSON lines: {e}") from e
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        raise XlamError(f"{path}: expected a list of records with query, tools and answers")
    return rows


def _decode(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _optional(spec: dict) -> bool:
    return "default" in spec or "optional" in str(spec.get("type", "")).lower()


def kind(declared: Any) -> str:
    """The JSON kind a declared type means ("List[int]" → array). Unknown types aren't checked."""
    base = re.sub(r"(?i)^optional\[(.*)\]$", r"\1", str(declared or "").strip()).split(",")[0].strip().lower()
    if base.startswith(("list", "tuple", "set")):
        return "array"
    if base.startswith("dict"):
        return "object"
    return {"int": "integer", "integer": "integer", "float": "number", "number": "number", "bool": "boolean", "boolean": "boolean", "str": "string", "string": "string"}.get(base, "any")


def fits(expected_kind: str, value: Any) -> bool:
    if value is None:
        return True
    if expected_kind == "integer":
        return (isinstance(value, int) and not isinstance(value, bool)) or (isinstance(value, float) and value.is_integer())
    if expected_kind == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected_kind == "boolean":
        return isinstance(value, bool)
    if expected_kind == "string":
        return isinstance(value, str)
    if expected_kind == "array":
        return isinstance(value, list)
    if expected_kind == "object":
        return isinstance(value, dict)
    return True


def problems(record: dict) -> set[str]:
    """What stops a record from being scored, as keys of :data:`ISSUES` (empty: usable)."""
    found: set[str] = set()
    if not str(record.get("query") or "").strip():
        found.add("no_query")
    try:
        tools = _decode(record.get("tools"))
        answers = _decode(record.get("answers"))
    except (json.JSONDecodeError, TypeError):
        return found | {"bad_json"}
    offered: dict[str, dict] = {}
    if not isinstance(tools, list):
        found.add("bad_tools")
        tools = []
    for t in tools:
        if not isinstance(t, dict) or not str(t.get("name") or "").strip() or not isinstance(t.get("parameters", {}), dict):
            found.add("bad_tools")
            continue
        params = t.get("parameters") or {}
        if any(not isinstance(p, dict) for p in params.values()):
            found.add("bad_tools")
            continue
        if t["name"] in offered:
            found.add("duplicate_tool")
        offered[t["name"]] = params
    if not isinstance(answers, list) or not answers:
        return found | {"no_answers"}
    for a in answers:
        if not isinstance(a, dict) or not str(a.get("name") or "").strip() or not isinstance(a.get("arguments", {}), dict):
            found.add("bad_answer")
            continue
        params = offered.get(a["name"])
        if params is None:
            found.add("unknown_function")
            continue
        args = a.get("arguments") or {}
        if any(name not in params for name in args):
            found.add("unknown_argument")
        if any(name not in args for name, spec in params.items() if not _optional(spec)):
            found.add("missing_required")
        if any(name in params and not fits(kind(params[name].get("type")), value) for name, value in args.items()):
            found.add("wrong_type")
    return found


def stratum(record: dict) -> str:
    """simple: one call; parallel: one function called several times; multiple: several functions
    once each; parallel multiple: several functions, some called more than once."""
    calls = [a.get("name") for a in _decode(record["answers"])]
    if len(calls) == 1:
        return "simple"
    counts = Counter(calls)
    if len(counts) == 1:
        return "parallel"
    return "parallel multiple" if max(counts.values()) > 1 else "multiple"


def check(rows: list[dict]) -> dict:
    """Every record checked. Returns counts per problem, a few example ids for each, and the ids
    of the usable records."""
    issues: Counter = Counter()
    examples: dict[str, list] = {k: [] for k in ISSUES}
    usable: list = []
    shapes: Counter = Counter()
    ids = Counter(r.get("id") for r in rows)
    for r in rows:
        p = problems(r)
        for k in p:
            issues[k] += 1
            if len(examples[k]) < 5:
                examples[k].append(r.get("id"))
        if not p:
            usable.append(r.get("id"))
            shapes[stratum(r)] += 1
    return {
        "records": len(rows),
        "usable": len(usable),
        "unusable": len(rows) - len(usable),
        "duplicate_ids": sum(1 for v in ids.values() if v > 1),
        "issues": {k: issues.get(k, 0) for k in ISSUES},
        "examples": {k: v for k, v in examples.items() if v},
        "strata": {s: shapes.get(s, 0) for s in STRATA},
        "usable_ids": usable,
    }


def _quotas(sizes: dict[str, int], n: int) -> dict[str, int]:
    """n split across strata in proportion to their sizes (largest remainders), at least one each where possible."""
    total = sum(sizes.values())
    if total == 0:
        return {k: 0 for k in sizes}
    raw = {k: n * v / total for k, v in sizes.items()}
    q = {k: min(sizes[k], int(raw[k])) for k in sizes}
    for k in sizes:
        if sizes[k] and q[k] == 0 and sum(q.values()) < n:
            q[k] = 1
    for k in sorted(sizes, key=lambda k: raw[k] - int(raw[k]), reverse=True):
        if sum(q.values()) >= n:
            break
        if q[k] < sizes[k]:
            q[k] += 1
    return q


def fixed_sample(rows: list[dict], usable_ids: list, n: int = 200, seed: int = 7) -> dict:
    """A stratified sample of usable records, by id: the same file and seed always give the same ids."""
    by_id = {r.get("id"): r for r in rows}
    groups: dict[str, list] = {s: [] for s in STRATA}
    for i in sorted(usable_ids, key=lambda v: (str(type(v)), v)):
        groups[stratum(by_id[i])].append(i)
    quotas = _quotas({s: len(g) for s, g in groups.items()}, min(n, len(usable_ids)))
    rng = random.Random(seed)
    picked: list = []
    for s in STRATA:
        g = list(groups[s])
        rng.shuffle(g)
        picked += g[: quotas[s]]
    return {"seed": seed, "size": len(picked), "strata": {s: quotas[s] for s in STRATA}, "ids": sorted(picked, key=lambda v: (str(type(v)), v))}


def sample_document(path: str | Path, rows: list[dict], result: dict, sample: dict) -> dict:
    p = Path(path)
    return {
        "about": "A fixed sample of Salesforce's xLAM Function Calling 60K for measuring a model's tool calling. Ids only: score against your own download (CC-BY-4.0, after accepting the dataset's access conditions on Hugging Face). Records that failed the checks were never sampled.",
        "source": {"file": p.name, "sha256": sha256(p), "records": len(rows), "usable": result["usable"]},
        "method": "Usable records grouped by the shape of their expected calls (simple, multiple, parallel, parallel multiple); each group sampled in proportion to its size; ids shuffled with Python's random.Random(seed).",
        **sample,
    }


def load_sample(path: str | Path, sample: int = 200, seed: int = 7, fixed: Path | None = SAMPLE_FILE) -> tuple[list[dict], str]:
    """The records to score and how they were chosen: the fixed sample when this is the file it was
    drawn from (same SHA-256) and the size matches, otherwise a seeded random sample, said so."""
    rows = read(path)
    if fixed and Path(fixed).exists() and sample:
        doc = json.loads(Path(fixed).read_text(encoding="utf-8"))
        if doc.get("size") == sample:
            digest = sha256(path)
            if digest == doc["source"]["sha256"]:
                by_id = {r.get("id"): r for r in rows}
                missing = [i for i in doc["ids"] if i not in by_id]
                if missing:
                    raise XlamError(f"{len(missing)} ids of the fixed sample aren’t in {path}, though its hash matches")
                return [by_id[i] for i in doc["ids"]], f"the fixed sample of {len(doc['ids'])} ({Path(fixed).name}, drawn from this exact file)"
            how = f"a seeded random sample of {sample} (seed {seed}): this file’s SHA-256 isn’t the one the fixed sample was drawn from, so the fixed ids don’t apply"
            random.Random(seed).shuffle(rows)
            return rows[:sample], how
    random.Random(seed).shuffle(rows)
    return rows[:sample], f"a seeded random sample of {min(sample, len(rows))} (seed {seed})"


def markdown(path: str | Path, result: dict, sample: dict | None = None) -> str:
    p = Path(path)
    lines = [
        "# xLAM Function Calling 60K: every record checked",
        "",
        "> Salesforce xLAM Function Calling 60K. Licence: CC-BY-4.0, after accepting the dataset’s access conditions on Hugging Face. The records stay in your download; this report holds counts and ids only.",
        "",
        f"**{result['usable']:,} of {result['records']:,} records can be scored** ({result['unusable']:,} can’t).",
        "",
        "| Problem | Records |",
        "|---|---:|",
    ]
    lines += [f"| {ISSUES[k]} | {v:,} |" for k, v in result["issues"].items()]
    lines += ["", "A record can have more than one problem. Example ids for each problem are in check.json.", ""]
    lines += ["## Usable records by the shape of their expected calls", "", "| Shape | Records |", "|---|---:|"]
    lines += [f"| {s} | {v:,} |" for s, v in result["strata"].items()]
    if result["duplicate_ids"]:
        lines += ["", f"{result['duplicate_ids']} ids appear more than once."]
    if sample:
        lines += ["", "## The fixed sample", "", f"{sample['size']} usable records, seed {sample['seed']}: " + ", ".join(f"{v} {s}" for s, v in sample["strata"].items()) + "."]
    lines += [
        "",
        "## What this doesn’t check",
        "",
        "- Whether an expected argument’s value is what the question asked for. APIGen checked that when it made the data (its authors report above 95% correct in a human review of 600 records); this report only checks structure and kinds.",
        "- Types it can’t check (Callable, Union) are taken as they are.",
        "",
        f"Source: {p.name}, SHA-256 {sha256(p)}.",
    ]
    return "\n".join(lines) + "\n"
