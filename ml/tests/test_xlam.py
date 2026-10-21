import json
import tempfile
import unittest
from pathlib import Path

from niveloft_ml import xlam


def record(i, answers, tools=None, query="Do the thing"):
    tools = tools if tools is not None else [
        {"name": "add", "description": "Add numbers.", "parameters": {"a": {"type": "int", "description": ""}, "b": {"type": "int, optional", "description": "", "default": 1}}},
        {"name": "say", "description": "Say words.", "parameters": {"text": {"type": "str", "description": ""}, "tags": {"type": "List[str]", "description": "", "default": []}}},
    ]
    return {"id": i, "query": query, "tools": json.dumps(tools), "answers": json.dumps(answers)}


GOOD = [
    record(0, [{"name": "add", "arguments": {"a": 1}}]),
    record(1, [{"name": "add", "arguments": {"a": 1, "b": 2}}, {"name": "add", "arguments": {"a": 3}}]),
    record(2, [{"name": "add", "arguments": {"a": 1}}, {"name": "say", "arguments": {"text": "hi", "tags": ["x"]}}]),
    record(3, [{"name": "add", "arguments": {"a": 1}}, {"name": "add", "arguments": {"a": 2}}, {"name": "say", "arguments": {"text": "x"}}]),
    record(4, [{"name": "add", "arguments": {"a": 2.0}}]),  # a whole float is an integer
]


class CheckTest(unittest.TestCase):
    def test_flags_what_a_scorer_cant_settle(self):
        cases = {
            "unknown_function": record(10, [{"name": "multiply", "arguments": {"a": 1}}]),
            "unknown_argument": record(11, [{"name": "add", "arguments": {"a": 1, "c": 2}}]),
            "missing_required": record(12, [{"name": "say", "arguments": {"tags": []}}]),
            "wrong_type": record(13, [{"name": "add", "arguments": {"a": 1.5}}]),
            "duplicate_tool": record(14, [{"name": "add", "arguments": {"a": 1}}], tools=[{"name": "add", "parameters": {"a": {"type": "int"}}}, {"name": "add", "parameters": {"a": {"type": "int"}}}]),
            "no_answers": record(15, []),
            "no_query": record(16, [{"name": "add", "arguments": {"a": 1}}], query=" "),
        }
        bad_json = {"id": 17, "query": "q", "tools": "[not json", "answers": "[]"}
        for issue, r in cases.items():
            self.assertIn(issue, xlam.problems(r), issue)
        self.assertEqual(xlam.problems(bad_json), {"bad_json"})
        for r in GOOD:
            self.assertEqual(xlam.problems(r), set(), r["id"])
        result = xlam.check(GOOD + list(cases.values()) + [bad_json])
        self.assertEqual(result["records"], 13)
        self.assertEqual(result["usable"], 5)
        self.assertEqual(result["usable_ids"], [0, 1, 2, 3, 4])
        self.assertEqual(result["issues"]["wrong_type"], 1)
        self.assertEqual(result["examples"]["unknown_function"], [10])
        self.assertEqual(result["strata"], {"simple": 2, "multiple": 1, "parallel": 1, "parallel multiple": 1})

    def test_kinds_follow_the_declared_types(self):
        self.assertEqual(xlam.kind("List[Tuple[float, float]]"), "array")
        self.assertEqual(xlam.kind("int, optional"), "integer")
        self.assertEqual(xlam.kind("Optional[str]"), "string")
        self.assertEqual(xlam.kind("Callable[[float], float]"), "any")
        self.assertFalse(xlam.fits("integer", True))
        self.assertTrue(xlam.fits("number", 3))
        self.assertFalse(xlam.fits("string", 3))


class SampleTest(unittest.TestCase):
    def rows(self, n=400):
        out = []
        for i in range(n):
            shape = i % 4
            if shape == 0:
                answers = [{"name": "add", "arguments": {"a": i}}]
            elif shape == 1:
                answers = [{"name": "add", "arguments": {"a": i}}, {"name": "add", "arguments": {"a": i + 1}}]
            elif shape == 2:
                answers = [{"name": "add", "arguments": {"a": i}}, {"name": "say", "arguments": {"text": "x"}}]
            else:
                answers = [{"name": "add", "arguments": {"a": 1.5}}]  # unusable
            out.append(record(i, answers))
        return out

    def test_the_same_file_and_seed_give_the_same_stratified_ids(self):
        rows = self.rows()
        result = xlam.check(rows)
        a = xlam.fixed_sample(rows, result["usable_ids"], 30, 7)
        b = xlam.fixed_sample(list(reversed(rows)), list(reversed(result["usable_ids"])), 30, 7)
        self.assertEqual(a, b)
        self.assertEqual(a["size"], 30)
        self.assertEqual(a["strata"], {"simple": 10, "multiple": 10, "parallel": 10, "parallel multiple": 0})
        self.assertTrue(all(i % 4 != 3 for i in a["ids"]))  # never an unusable record
        self.assertNotEqual(a["ids"], xlam.fixed_sample(rows, result["usable_ids"], 30, 8)["ids"])

    def test_loads_the_fixed_sample_only_from_the_file_it_was_drawn_from(self):
        rows = self.rows()
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / "xlam.json"
            data.write_text(json.dumps(rows), encoding="utf-8")
            result = xlam.check(rows)
            doc = xlam.sample_document(data, rows, result, xlam.fixed_sample(rows, result["usable_ids"], 20, 7))
            self.assertNotIn("query", json.dumps(doc))  # ids and a hash, never records
            fixed = Path(d) / "sample.json"
            fixed.write_text(json.dumps(doc), encoding="utf-8")
            picked, how = xlam.load_sample(data, 20, 7, fixed)
            self.assertEqual([r["id"] for r in picked], doc["ids"])
            self.assertIn("fixed sample of 20", how)

            changed = Path(d) / "other.json"
            changed.write_text(json.dumps(rows[:-1]), encoding="utf-8")
            picked, how = xlam.load_sample(changed, 20, 7, fixed)
            self.assertEqual(len(picked), 20)
            self.assertIn("SHA-256 isn’t the one", how)

            picked, how = xlam.load_sample(data, 10, 7, fixed)  # another size: a seeded sample, said so
            self.assertEqual(len(picked), 10)
            self.assertIn("seeded random sample of 10", how)

    def test_the_committed_sample_holds_ids_and_a_hash_only(self):
        doc = json.loads(xlam.SAMPLE_FILE.read_text(encoding="utf-8"))
        self.assertEqual(doc["size"], 200)
        self.assertEqual(len(doc["ids"]), 200)
        self.assertEqual(len(set(doc["ids"])), 200)
        self.assertEqual(sum(doc["strata"].values()), 200)
        self.assertRegex(doc["source"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(set(doc), {"about", "source", "method", "seed", "size", "strata", "ids"})


if __name__ == "__main__":
    unittest.main()
