import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from niveloft_ml.__main__ import main


def run(*args) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main(list(args))
    return code, out.getvalue(), err.getvalue()


class CommandLineTest(unittest.TestCase):
    def test_synthetic_then_train_writes_a_report_and_a_model_only_when_it_wins(self):
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / "SYN-task-history-v1.csv"
            code, out, _ = run("synthetic", "--out", str(data), "--tasks", "1200")
            self.assertEqual(code, 0)
            self.assertIn("(synthetic)", out)
            code, out, _ = run("train", "--data", str(data), "--out", str(Path(d) / "r"), "--with", "xgboost")
            self.assertEqual(code, 0)
            names = sorted(p.name for p in (Path(d) / "r").iterdir())
            self.assertEqual(names, ["model.joblib", "model.json", "report.json", "report.md"])  # model.json: for the server's trial
            md = (Path(d) / "r" / "report.md").read_text(encoding="utf-8")
            self.assertIn("**Synthetic data.**", md)
            report = json.loads((Path(d) / "r" / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["decision"]["verdict"], "model-is-better")
            self.assertTrue(any("xgboost" in n for n in report["notes"]))  # asked for, not installed: said so

            code, _, _ = run("train", "--data", str(data), "--out", str(Path(d) / "r2"), "--no-model")
            self.assertEqual(sorted(p.name for p in (Path(d) / "r2").iterdir()), ["report.json", "report.md"])

    def test_plain_history_keeps_niveloft_and_saves_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / "SYN.csv"
            run("synthetic", "--out", str(data), "--tasks", "1200", "--plain")
            code, out, _ = run("train", "--data", str(data), "--out", str(Path(d) / "r"))
            self.assertEqual(code, 0)
            self.assertIn("Keep Niveloft’s forecast", out)
            self.assertNotIn("model.joblib", [p.name for p in (Path(d) / "r").iterdir()])

    def test_a_wrong_file_is_a_readable_error(self):
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "bad.csv"
            bad.write_text("a,b\n1,2\n", encoding="utf-8")
            code, _, err = run("train", "--data", str(bad), "--out", str(Path(d) / "r"))
            self.assertEqual(code, 2)
            self.assertIn("not a Niveloft task history", err)

    def test_public_all_runs_what_it_finds_and_says_what_it_skipped(self):
        import numpy as np
        import pandas as pd

        rng = np.random.default_rng(11)
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / "data"
            data.mkdir()
            lines = ["@relation desharnais"] + [f"@attribute {c} numeric" for c in ["Project", "TeamExp", "ManagerExp", "YearEnd", "Length", "Effort", "Transactions", "Entities", "PointsNonAdjust", "Adjustment", "PointsAjust"]]
            lines += ["@attribute Language {1,2,3}", "@data"]
            for i in range(40):
                pts = rng.uniform(50, 800)
                lines.append(f"{i + 1},{rng.integers(0, 5) if i != 5 else -1},{rng.integers(0, 8)},85,{rng.integers(1, 30)},{12 * pts * rng.uniform(0.7, 1.3):.0f},{rng.integers(10, 400)},{rng.integers(5, 300)},{pts:.0f},{rng.integers(5, 50)},{pts:.0f},{1 + i % 3}")
            (data / "02.desharnais.arff").write_text("\n".join(lines) + "\n", encoding="utf-8")
            words = {"high": "urgent outage down broken", "low": "question idea typo wish"}
            pd.DataFrame(
                [{"subject": f"T{i}", "body": " ".join(rng.choice(words["high" if i % 2 else "low"].split(), 3)) + f" n{i}", "priority": "high" if i % 2 else "low", "language": "en"} for i in range(120)]
            ).to_csv(data / "aa_dataset-tickets-multi-lang-5-2-50-version.csv", index=False)
            tools = json.dumps([{"name": "add", "parameters": {"a": {"type": "int"}}}])
            (data / "xlam_function_calling_60k.json").write_text(
                json.dumps([{"id": i, "query": f"add {i}", "tools": tools, "answers": json.dumps([{"name": "add", "arguments": {"a": i}}])} for i in range(30)]), encoding="utf-8"
            )
            out = Path(d) / "out"
            code, stdout, _ = run("public", "all", "--dir", str(data), "--out", str(out))
            self.assertEqual(code, 0, stdout)
            summary = (out / "SUMMARY.md").read_text(encoding="utf-8")
            self.assertIn("| 02.desharnais.arff |", summary)
            self.assertIn("30 of 30 can be scored", summary)
            self.assertIn("balanced accuracy", summary)
            self.assertIn("Project Management Risk Raw: no file", summary)
            self.assertIn("don't measure Flurry's conversational accuracy", summary)
            self.assertTrue((out / "effort" / "report.md").exists())
            self.assertTrue((out / "xlam" / "sample.json").exists())
            facts = json.loads((out / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(len(facts["sources"]), 3)
            self.assertTrue(all(len(s["sha256"]) == 64 for s in facts["sources"]))

            code, stdout, _ = run("xlam", "--data", str(data / "xlam_function_calling_60k.json"), "--out", str(Path(d) / "x"), "--sample", "10")
            self.assertEqual(code, 0)
            self.assertIn("30 of 30 records can be scored; fixed sample of 10: 10 simple", stdout)

    def test_lists_the_datasets_with_licences(self):
        code, out, _ = run("datasets")
        self.assertEqual(code, 0)
        self.assertIn("support-tickets", out)
        self.assertIn("commercial use: no", out)


if __name__ == "__main__":
    unittest.main()
