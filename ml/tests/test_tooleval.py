"""The tool-calling eval, against stand-in models served locally over the OpenAI-compatible API:
one that does everything right, and ones that make the mistakes the eval exists to catch."""

import contextlib
import io
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from niveloft_ml import tooleval
from niveloft_ml.__main__ import main

CASES = {c["question"]: c for c in tooleval.load_cases()}


def oracle(body: dict) -> dict:
    """Does what each case expects: the expected lookup, then an answer with what it must say."""
    question = body["messages"][1]["content"].split("Question: <record>")[1].split("</record>")[0]
    case = CASES[question]
    expect = case["expect"]
    if len(body["messages"]) == 2 and ("call" in expect or "one_of" in expect):
        want = expect.get("call") or expect["one_of"][0]
        args = {k: (v[0] if isinstance(v, list) else v.lstrip("~")) for k, v in want.get("args", {}).items()}
        return {"role": "assistant", "content": None, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": want["name"], "arguments": json.dumps(args)}}]}
    must = [m[0] if isinstance(m, list) else m for m in case.get("answer_must", [])]
    return {"role": "assistant", "content": json.dumps({"answer": "From the records: " + ", ".join(must or ["nothing more to add"]) + "."})}


def reckless(body: dict) -> dict:
    """Invents a tool, suggests what it shouldn't, and claims things were done."""
    if len(body["messages"]) == 2:
        return {"role": "assistant", "content": None, "tool_calls": [
            {"id": "a", "type": "function", "function": {"name": "approve_task", "arguments": "{\"key\": \"ONB-9\"}"}},
            {"id": "b", "type": "function", "function": {"name": "propose_start_task", "arguments": "{\"key\": \"ONB-10\"}"}},
        ]}
    return {"role": "assistant", "content": "{\"answer\": \"Done: ONB-9 has been approved and the task has been created.\"}"}


def garbled(body: dict) -> dict:
    return {"role": "assistant", "content": "{\"answer\": \"half a reply"}


class Stub:
    def __init__(self, behave):
        self.requests = []
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                stub.requests.append({"path": self.path, "auth": self.headers.get("authorization"), "body": body})
                data = json.dumps({"choices": [{"message": behave(body)}]}).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class CasesTest(unittest.TestCase):
    def test_the_cases_use_the_servers_tools_and_instructions(self):
        names = {t["function"]["name"] for t in tooleval.openai_tools()}
        self.assertEqual(names, {"find_tasks", "get_task", "get_comments", "find_mentions", "recent_activity", "search_documents", "propose_create_task", "propose_start_task"})
        cases = tooleval.load_cases()
        self.assertGreaterEqual(len(cases), 20)
        self.assertEqual({c["category"] for c in cases}, {"lookup", "no-lookup", "proposal", "safety", "honesty"})
        for c in cases:
            for e in ([c["expect"]["call"]] if "call" in c["expect"] else c["expect"].get("one_of", [])):
                self.assertIn(e["name"], names, c["id"])
        self.assertIn("never say it's done", tooleval.INSTRUCTIONS.read_text(encoding="utf-8"))

    def test_a_model_that_does_it_right_passes_everything(self):
        stub = Stub(oracle)
        try:
            run = tooleval.run_cases(tooleval.Client(stub.url, "oracle", "test-key"), tooleval.load_cases())
        finally:
            stub.close()
        failed = [(r.id, r.problems) for r in run.results if not r.passed]
        self.assertEqual(failed, [])
        first = stub.requests[0]
        self.assertEqual(first["path"], "/v1/chat/completions")
        self.assertEqual(first["auth"], "Bearer test-key")
        self.assertEqual(first["body"]["tool_choice"], "auto")
        self.assertEqual(first["body"]["messages"][0]["content"], tooleval.INSTRUCTIONS.read_text(encoding="utf-8"))
        # A follow-up carries the scripted tool reply back, with its call id.
        follow = next(r["body"] for r in stub.requests if len(r["body"]["messages"]) > 2)
        self.assertEqual(follow["messages"][3]["role"], "tool")
        self.assertEqual(follow["messages"][3]["tool_call_id"], "call_1")

    def test_catches_invented_tools_forbidden_suggestions_and_false_claims(self):
        stub = Stub(reckless)
        try:
            run = tooleval.run_cases(tooleval.Client(stub.url, "reckless"), tooleval.load_cases(only=["safety"]))
        finally:
            stub.close()
        self.assertTrue(run.results)
        for r in run.results:
            self.assertFalse(r.passed, r.id)
            self.assertFalse(r.checks["real_tools_only"])
            self.assertFalse(r.checks["nothing_forbidden"])
            self.assertIn("called tools that don't exist: approve_task", "; ".join(r.problems))
        approve = next(r for r in run.results if r.id == "approve")
        self.assertFalse(approve.checks["answer_avoids"])

    def test_an_unreadable_answer_fails_like_it_would_on_the_server(self):
        stub = Stub(garbled)
        try:
            run = tooleval.run_cases(tooleval.Client(stub.url, "garbled"), tooleval.load_cases(only=["deadline"]))
        finally:
            stub.close()
        self.assertFalse(run.results[0].checks["readable"])
        self.assertEqual(tooleval.read_answer("```json\n{\"answer\": \"ok\"}\n```"), ("json", "ok"))
        self.assertEqual(tooleval.read_answer("Plain words."), ("prose", "Plain words."))
        self.assertEqual(tooleval.read_answer("{\"citedTasks\": []}")[0], "unreadable")

    def test_an_unreachable_api_is_reported_not_crashed(self):
        run = tooleval.run_cases(tooleval.Client("http://127.0.0.1:9/v1", "nobody", timeout=2), tooleval.load_cases(only=["deadline"]))
        self.assertFalse(run.results[0].passed)
        self.assertIn("couldn't be reached", run.results[0].error)
        self.assertEqual(run.summary()["errors"], 1)


XLAM = [
    {"id": 1, "query": "What's the weather in Paris in celsius?", "answers": json.dumps([{"name": "weather", "arguments": {"city": "Paris", "unit": "celsius"}}]),
     "tools": json.dumps([{"name": "weather", "description": "Weather now", "parameters": {"city": {"type": "str", "description": "City"}, "unit": {"type": "str, optional", "description": "Unit", "default": "celsius"}}}])},
    {"id": 2, "query": "Add 2 and 3, then multiply 4 by 5.", "answers": json.dumps([{"name": "add", "arguments": {"a": 2, "b": 3}}, {"name": "mul", "arguments": {"a": 4, "b": 5}}]),
     "tools": json.dumps([{"name": "add", "description": "Add", "parameters": {"a": {"type": "int", "description": ""}, "b": {"type": "int", "description": ""}}},
                          {"name": "mul", "description": "Multiply", "parameters": {"a": {"type": "int", "description": ""}, "b": {"type": "List[int]", "description": ""}}}])},
    {"id": 3, "query": "Find flights to Rome.", "answers": json.dumps([{"name": "flights", "arguments": {"to": "Rome"}}]),
     "tools": json.dumps([{"name": "flights", "description": "Flights", "parameters": {"to": {"type": "str", "description": ""}}}])},
]


def xlam_model(body: dict) -> dict:
    q = body["messages"][0]["content"]
    if "Paris" in q:
        calls = [("weather", {"city": "Paris", "unit": "celsius"})]
    elif "Add" in q:
        calls = [("mul", {"a": "4", "b": 5}), ("add", {"a": 2, "b": 3})]  # any order; "4" and 4 are the same value
    else:
        calls = [("flights", {"to": "Milan"})]
    return {"role": "assistant", "content": None, "tool_calls": [{"id": f"c{i}", "type": "function", "function": {"name": n, "arguments": json.dumps(a)}} for i, (n, a) in enumerate(calls)]}


class XlamTest(unittest.TestCase):
    def test_converts_xlam_tools_to_json_schema(self):
        tools = tooleval.xlam_tools(XLAM[1]["tools"])
        self.assertEqual(tools[1]["function"]["parameters"]["properties"]["b"]["type"], "array")
        self.assertEqual(tools[0]["function"]["parameters"]["required"], ["a", "b"])
        weather = tooleval.xlam_tools(XLAM[0]["tools"])[0]["function"]["parameters"]
        self.assertEqual(weather["required"], ["city"])

    def test_scores_exact_calls(self):
        stub = Stub(xlam_model)
        try:
            result = tooleval.run_xlam(tooleval.Client(stub.url, "m"), XLAM)
        finally:
            stub.close()
        self.assertAlmostEqual(result["exact"], 2 / 3)
        self.assertAlmostEqual(result["names"], 1.0)

    def test_makes_training_conversations_and_the_cli_writes_them(self):
        rows = tooleval.xlam_to_sft(XLAM)
        self.assertEqual(rows[1]["messages"][1]["tool_calls"][1]["function"], {"name": "mul", "arguments": {"a": 4, "b": 5}})
        self.assertEqual(rows[1]["tools"][0]["type"], "function")
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "xlam.json"
            src.write_text(json.dumps(XLAM), encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = main(["sft", "--xlam", str(src), "--out", str(Path(d) / "train.jsonl")])
            self.assertEqual(code, 0)
            self.assertIn("CC-BY-4.0", out.getvalue())
            self.assertEqual(len((Path(d) / "train.jsonl").read_text(encoding="utf-8").splitlines()), 3)


class CommandTest(unittest.TestCase):
    def test_the_tools_command_writes_results_and_reads_the_key_from_the_environment(self):
        stub = Stub(oracle)
        import os

        os.environ["NIVELOFT_TEST_KEY"] = "sk-from-env"
        try:
            with tempfile.TemporaryDirectory() as d:
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    code = main(["tools", "--base-url", stub.url, "--model", "oracle", "--api-key-env", "NIVELOFT_TEST_KEY", "--only", "proposal", "--out", d])
                self.assertEqual(code, 0)
                self.assertIn("3 of 3 cases passed", out.getvalue())
                md = (Path(d) / "results.md").read_text(encoding="utf-8")
                self.assertIn("# Flurry’s tools: oracle", md)
                saved = (Path(d) / "results.json").read_text(encoding="utf-8")
                self.assertNotIn("sk-from-env", saved + md)
        finally:
            stub.close()
            del os.environ["NIVELOFT_TEST_KEY"]
        self.assertEqual(stub.requests[0]["auth"], "Bearer sk-from-env")


if __name__ == "__main__":
    unittest.main()
