"""Measuring a model on Flurry's tools, before any fine-tuning.

Two measurements, against any OpenAI-compatible chat API (OpenAI, Groq, OpenRouter, vLLM or
Ollama serving Qwen3 or an xLAM model, LM Studio …):

  cases  Niveloft's own cases (ml/eval_cases/flurry-tools.jsonl): Flurry's real instructions and
         tools (backend/src/main/resources/ai/tools.json), a project summary, and a question. Does
         the model look up what it needs and only that, suggest changes only through the proposal
         tools, refuse what no tool can do, stay out of other projects, treat what records say as
         data, and answer in a form the server can read? Where a case scripts the tools' replies,
         the conversation continues and the answer is checked too.
  xlam   a sample of Salesforce's xLAM function-calling data (download it yourself after
         accepting its terms): general function calling, scored by exact calls.

Fine-tune only if these show a gap that matters, and keep these cases out of any training data:
they're the test.
"""

from __future__ import annotations

import json
import os
import random
import re
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "eval_cases" / "flurry-tools.jsonl"
INSTRUCTIONS = ROOT / "eval_cases" / "flurry-instructions.txt"
SUMMARY = ROOT / "eval_cases" / "onb-summary.txt"
TOOLS = ROOT.parent / "backend" / "src" / "main" / "resources" / "ai" / "tools.json"
NO_RESULT = "No records were looked up in this test."


# ---------------------------------------------------------------- the API


class ApiError(RuntimeError):
    pass


class Client:
    """A minimal OpenAI-compatible chat client (standard library only). The key comes from an
    environment variable and is never printed or written anywhere."""

    def __init__(self, base_url: str, model: str, api_key: str | None = None, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout = timeout

    def chat(self, messages: list[dict], tools: list[dict] | None, tool_choice: str = "auto", max_tokens: int = 800) -> dict:
        body: dict[str, Any] = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": 0}
        if tools:
            body["tools"] = tools
            body["tool_choice"] = tool_choice
        req = urllib.request.Request(self.base_url + "/chat/completions", data=json.dumps(body).encode("utf-8"), method="POST")
        req.add_header("content-type", "application/json")
        if self.api_key:
            req.add_header("authorization", "Bearer " + self.api_key)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                data = json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise ApiError(f"HTTP {e.code} from the model's API") from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            raise ApiError(f"the model's API couldn't be reached or answered oddly ({type(e).__name__})") from None
        try:
            return data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError):
            raise ApiError("the reply had no message") from None


def openai_tools(path: Path = TOOLS) -> list[dict]:
    """Flurry's tools (the same file the server reads) in the OpenAI format."""
    catalog = json.loads(path.read_text(encoding="utf-8"))
    return [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}} for t in catalog["tools"]]


def calls_of(message: dict) -> list[dict]:
    """The tool calls in a reply, with arguments as an object (unreadable arguments become {})."""
    out = []
    for i, c in enumerate(message.get("tool_calls") or []):
        fn = c.get("function") or {}
        args = fn.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args) if args.strip() else {}
            except json.JSONDecodeError:
                args = {}
        out.append({"id": c.get("id") or f"call_{i + 1}", "name": fn.get("name") or "", "arguments": args if isinstance(args, dict) else {}})
    return out


# ---------------------------------------------------------------- reading answers like the server


def json_objects(text: str) -> list[str]:
    """Every balanced {...} in a text, ignoring braces inside JSON strings (AiService.jsonCandidates)."""
    out, depth, start, in_string, escaped = [], 0, -1, False, False
    for i, ch in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"' and depth > 0:
            in_string = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0:
                out.append(text[start : i + 1])
                if len(out) >= 20:
                    break
    return out


def read_answer(text: str | None) -> tuple[str, str]:
    """(format, answer): "json" when there's an object with an answer, "prose" when there are no
    braces at all (the server shows it, with a note), else "unreadable" (the server refuses it)."""
    t = text or ""
    for candidate in json_objects(t):
        try:
            obj = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            for key in ("answer", "response", "text", "message"):
                if isinstance(obj.get(key), str) and obj[key].strip():
                    return "json", obj[key]
            return "unreadable", ""
    prose = re.sub(r"```[A-Za-z]*", "", t).strip()
    if prose and "{" not in prose:
        return "prose", prose
    return "unreadable", ""


# ---------------------------------------------------------------- Niveloft's cases


@dataclass
class CaseResult:
    id: str
    category: str
    passed: bool
    checks: dict[str, bool]
    problems: list[str]
    first_calls: list[dict]
    answer_format: str = ""
    answer: str = ""
    error: str | None = None
    seconds: float = 0.0


def _arg_ok(expected: Any, actual: Any) -> bool:
    if isinstance(expected, list):
        return any(_arg_ok(e, actual) for e in expected)
    if isinstance(expected, str):
        a = str(actual) if actual is not None else ""
        if expected.startswith("~"):
            return expected[1:].lower() in a.lower()
        return a.strip().lower() == expected.lower()
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        try:
            return float(actual) == float(expected)
        except (TypeError, ValueError):
            return False
    return actual == expected


def _call_ok(expected: dict, call: dict) -> bool:
    return call["name"] == expected["name"] and all(_arg_ok(v, call["arguments"].get(k)) for k, v in expected.get("args", {}).items())


def _contains(text: str, item: Any) -> bool:
    if isinstance(item, list):
        return any(_contains(text, i) for i in item)
    return str(item).lower() in text.lower()


def run_case(client: Client, case: dict, tools: list[dict], instructions: str, summary: str, max_rounds: int = 3) -> CaseResult:
    names = {t["function"]["name"] for t in tools}
    messages = [{"role": "system", "content": instructions}, {"role": "user", "content": f"{summary}\nQuestion: <record>{case['question']}</record>\n"}]
    started = time.monotonic()
    problems: list[str] = []
    checks: dict[str, bool] = {}
    try:
        reply = client.chat(messages, tools)
    except ApiError as e:
        return CaseResult(case["id"], case["category"], False, {}, [str(e)], [], error=str(e), seconds=time.monotonic() - started)
    first = calls_of(reply)
    expect = case.get("expect", {})

    # Choosing the tools.
    if "call" in expect:
        checks["choice"] = any(_call_ok(expect["call"], c) for c in first)
    elif "one_of" in expect:
        checks["choice"] = any(_call_ok(e, c) for e in expect["one_of"] for c in first)
    elif "none_or" in expect:
        checks["choice"] = all(c["name"] in expect["none_or"] for c in first)
    if checks.get("choice") is False:
        problems.append("looked up " + (", ".join(f"{c['name']}({json.dumps(c['arguments'], ensure_ascii=False)})" for c in first) or "nothing") + f", expected {json.dumps(expect, ensure_ascii=False)}")

    # Only real tools, and none the case forbids.
    invented = [c["name"] for c in first if c["name"] not in names]
    forbidden = [c["name"] for c in first if c["name"] in case.get("forbid", [])]
    checks["real_tools_only"] = not invented
    if invented:
        problems.append("called tools that don't exist: " + ", ".join(invented))
    if case.get("forbid"):
        checks["nothing_forbidden"] = not forbidden
        if forbidden:
            problems.append("called " + ", ".join(forbidden) + ", which this request must not use")

    # The conversation to its answer, with the case's scripted tool replies.
    final = reply
    rounds = 1
    calls = first
    while calls and rounds < max_rounds + 1:
        messages.append({"role": "assistant", "content": final.get("content"), "tool_calls": [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": json.dumps(c["arguments"], ensure_ascii=False)}} for c in calls
        ]})
        for c in calls:
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": case.get("results", {}).get(c["name"], NO_RESULT)})
        try:
            final = client.chat(messages, tools, tool_choice="none" if rounds >= max_rounds else "auto")
        except ApiError as e:
            return CaseResult(case["id"], case["category"], False, checks, problems + [str(e)], first, error=str(e), seconds=time.monotonic() - started)
        rounds += 1
        calls = calls_of(final)
        later_invented = [c["name"] for c in calls if c["name"] not in names]
        if later_invented:
            checks["real_tools_only"] = False
            problems.append("later called tools that don't exist: " + ", ".join(later_invented))
        if case.get("forbid") and any(c["name"] in case["forbid"] for c in calls):
            checks["nothing_forbidden"] = False
            problems.append("later called a tool this request must not use")

    fmt, answer = read_answer(final.get("content"))
    checks["readable"] = fmt != "unreadable"
    if fmt == "unreadable":
        problems.append("the final reply isn't something the server can read (no JSON object with an answer, and not plain prose)")
    if case.get("answer_must"):
        missing = [m for m in case["answer_must"] if not _contains(answer, m)]
        checks["answer_has"] = not missing
        if missing:
            problems.append("the answer doesn't mention " + ", ".join(json.dumps(m, ensure_ascii=False) for m in missing))
    if case.get("answer_must_not"):
        said = [m for m in case["answer_must_not"] if _contains(answer, m)]
        checks["answer_avoids"] = not said
        if said:
            problems.append("the answer says " + ", ".join(json.dumps(m, ensure_ascii=False) for m in said))
    return CaseResult(case["id"], case["category"], all(checks.values()), checks, problems, first, fmt, answer[:600], seconds=time.monotonic() - started)


def load_cases(path: Path = CASES, only: list[str] | None = None) -> list[dict]:
    cases = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [c for c in cases if not only or c["id"] in only or c["category"] in only]


@dataclass
class Run:
    model: str
    base_url: str
    results: list[CaseResult] = field(default_factory=list)

    def summary(self) -> dict:
        cats: dict[str, list[int]] = {}
        for r in self.results:
            cats.setdefault(r.category, [0, 0])
            cats[r.category][0] += int(r.passed)
            cats[r.category][1] += 1
        checks: dict[str, list[int]] = {}
        for r in self.results:
            for k, v in r.checks.items():
                checks.setdefault(k, [0, 0])
                checks[k][0] += int(v)
                checks[k][1] += 1
        passed = sum(r.passed for r in self.results)
        return {"passed": passed, "total": len(self.results), "by_category": cats, "by_check": checks, "errors": sum(r.error is not None for r in self.results)}


def run_cases(client: Client, cases: list[dict], tools_path: Path = TOOLS) -> Run:
    tools = openai_tools(tools_path)
    instructions = INSTRUCTIONS.read_text(encoding="utf-8")
    summary = SUMMARY.read_text(encoding="utf-8")
    run = Run(client.model, client.base_url)
    for case in cases:
        run.results.append(run_case(client, case, tools, instructions, summary))
    return run


CHECK_NAMES = {
    "choice": "Looked up what it needed, and only that",
    "real_tools_only": "Called only tools that exist",
    "nothing_forbidden": "Didn’t use a tool the request must not use",
    "readable": "Answered in a form the server can read",
    "answer_has": "The answer has what it must",
    "answer_avoids": "The answer avoids what it must not say",
}


def markdown(run: Run) -> str:
    s = run.summary()
    lines = [
        f"# Flurry’s tools: {run.model}",
        "",
        f"{s['passed']} of {s['total']} cases passed" + (f" ({s['errors']} couldn’t be run: the API failed)." if s["errors"] else "."),
        "",
        "| Kind of case | Passed |",
        "|---|---:|",
        *[f"| {k} | {v[0]} of {v[1]} |" for k, v in s["by_category"].items()],
        "",
        "| Check | Held in |",
        "|---|---:|",
        *[f"| {CHECK_NAMES.get(k, k)} | {v[0]} of {v[1]} |" for k, v in s["by_check"].items()],
        "",
        "## Cases that failed",
        "",
    ]
    failed = [r for r in run.results if not r.passed]
    lines += [f"- **{r.id}** ({r.category}): {'; '.join(r.problems)}" for r in failed] or ["None."]
    lines += ["", "Model replies vary: run twice before reading much into one case. These cases are a test, so keep them out of any training data."]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- xLAM


_TYPES = {"str": "string", "string": "string", "int": "integer", "integer": "integer", "float": "number", "number": "number", "bool": "boolean", "boolean": "boolean"}


def _json_type(t: str) -> str:
    t = (t or "").strip()
    base = re.sub(r"^Optional\[(.*)\]$", r"\1", t).split(",")[0].strip()
    if base.lower().startswith(("list", "tuple", "set")):
        return "array"
    if base.lower().startswith("dict"):
        return "object"
    return _TYPES.get(base.lower(), "string")


def xlam_tools(raw: Any) -> list[dict]:
    """xLAM's tool list (parameters as {name: {type, description, default}}) as OpenAI tools."""
    tools = json.loads(raw) if isinstance(raw, str) else raw
    out = []
    for t in tools:
        props, required = {}, []
        for name, p in (t.get("parameters") or {}).items():
            p = p if isinstance(p, dict) else {}
            props[name] = {"type": _json_type(str(p.get("type", "str"))), "description": str(p.get("description", ""))}
            optional = "default" in p or str(p.get("type", "")).startswith("Optional") or "optional" in str(p.get("type", "")).lower()
            if not optional:
                required.append(name)
        out.append({"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": {"type": "object", "properties": props, "required": required}}})
    return out


def _same_value(a: Any, b: Any) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        return float(a) == float(b)
    if isinstance(a, str) and isinstance(b, (int, float)) and not isinstance(b, bool):
        try:
            return float(a) == float(b)
        except ValueError:
            return False
    if isinstance(b, str) and isinstance(a, (int, float)) and not isinstance(a, bool):
        return _same_value(b, a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same_value(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same_value(a[k], b[k]) for k in a)
    if isinstance(a, str) and isinstance(b, str):
        return a.strip() == b.strip()
    return a == b


def xlam_score(expected: list[dict], got: list[dict]) -> dict:
    """Exact: the same calls (any order, each used once), same arguments. Names: the same functions."""
    remaining = list(got)
    exact = len(expected) == len(got)
    for e in expected:
        hit = next((g for g in remaining if g["name"] == e["name"] and _same_value(e.get("arguments", {}), g["arguments"])), None)
        if hit is None:
            exact = False
        else:
            remaining.remove(hit)
    names = sorted(e["name"] for e in expected) == sorted(g["name"] for g in got)
    return {"exact": exact, "names": names}


def load_xlam(path: str | Path, sample: int, seed: int = 7) -> list[dict]:
    text = Path(path).read_text(encoding="utf-8").strip()
    rows = json.loads(text) if text.startswith("[") else [json.loads(line) for line in text.splitlines() if line.strip()]
    random.Random(seed).shuffle(rows)
    return rows[:sample]


def run_xlam(client: Client, rows: list[dict]) -> dict:
    results = []
    for r in rows:
        expected = json.loads(r["answers"]) if isinstance(r["answers"], str) else r["answers"]
        try:
            msg = client.chat([{"role": "user", "content": r["query"]}], xlam_tools(r["tools"]), max_tokens=600)
            got = calls_of(msg)
            score = xlam_score(expected, got)
            results.append({"id": r.get("id"), **score, "calls": got})
        except ApiError as e:
            results.append({"id": r.get("id"), "exact": False, "names": False, "error": str(e)})
    n = len(results) or 1
    return {
        "model": client.model,
        "examples": len(results),
        "exact": sum(r["exact"] for r in results) / n,
        "names": sum(r["names"] for r in results) / n,
        "errors": sum("error" in r for r in results),
        "results": results,
    }


def api_key_from(env: str | None) -> str | None:
    return os.environ.get(env) if env else None


def to_dict(run: Run) -> dict:
    return {"model": run.model, "base_url": run.base_url, "summary": run.summary(), "results": [asdict(r) for r in run.results]}


# ---------------------------------------------------------------- training data, if it comes to that


def xlam_to_sft(rows: list[dict]) -> list[dict]:
    """xLAM examples as conversations with tool calls, in the format Hugging Face chat templates
    and TRL's SFTTrainer read ({"messages": [...], "tools": [...]}). Only for after an eval has
    shown a gap; never mix Niveloft's eval cases in."""
    out = []
    for r in rows:
        answers = json.loads(r["answers"]) if isinstance(r["answers"], str) else r["answers"]
        out.append(
            {
                "messages": [
                    {"role": "user", "content": r["query"]},
                    {"role": "assistant", "content": "", "tool_calls": [{"type": "function", "function": {"name": a["name"], "arguments": a.get("arguments", {})}} for a in answers]},
                ],
                "tools": xlam_tools(r["tools"]),
            }
        )
    return out
