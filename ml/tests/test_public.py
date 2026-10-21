import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from niveloft_ml import history as h
from niveloft_ml import public

MAPPING = json.loads((Path(__file__).resolve().parent.parent / "examples" / "jira-mapping.json").read_text(encoding="utf-8"))


class LicenceTest(unittest.TestCase):
    def test_records_the_licences_given(self):
        reg = public.registry()
        self.assertEqual(reg["support-tickets"]["licence"], "CC-BY-NC-4.0 (the creator’s current Hugging Face release)")
        self.assertEqual(reg["support-tickets"]["commercial_use"], "no")
        self.assertIn("CC-BY-4.0", reg["xlam-function-calling-60k"]["licence"])
        self.assertIn("access conditions", reg["xlam-function-calling-60k"]["licence"])
        self.assertIn("Project, Length and YearEnd are never inputs", reg["desharnais"]["caution"])
        self.assertIn("never pool them", reg["support-tickets"]["caution"])

    def test_non_commercial_data_never_yields_a_saved_model(self):
        note, may_save = public.licence_note("support-tickets")
        self.assertFalse(may_save)
        self.assertIn("CC-BY-NC-4.0", note)
        self.assertTrue(public.licence_note(None)[1])


class JiraTest(unittest.TestCase):
    def test_converts_an_export_without_names_or_text(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "issues.csv"
            pd.DataFrame(
                {
                    "key": ["HADOOP-1", "HADOOP-2", "HADOOP-3"],
                    "project": ["Hadoop", "Hadoop", "Hadoop"],
                    "created": ["2020-01-01 10:00", "2020-01-02 10:00", "2020-01-03 10:00"],
                    "resolutiondate": ["2020-01-04 10:00", "", "2020-01-05 10:00"],
                    "status": ["Resolved", "Open", "Closed"],
                    "resolution": ["Fixed", "", "Won't Fix"],
                    "priority": ["Major", "Blocker", "Trivial"],
                    "assignee": ["Alice Example", "Bob Example", "Alice Example"],
                    "timeoriginalestimate": ["57600", "", "28800"],
                    "duedate": ["2020-01-03", "", ""],
                    "description": ["Secret details", "", "x"],
                }
            ).to_csv(src, index=False)
            out = public.jira(src, MAPPING)
            self.assertEqual(list(out.columns), h.COLUMNS)
            self.assertEqual(out["status"].tolist(), ["DONE", "IN_PROGRESS", "IN_PROGRESS"])  # Won't Fix isn't finished work
            self.assertEqual(out["priority"].tolist(), ["HIGH", "URGENT", "LOW"])
            self.assertEqual(out["estimate_days"].tolist(), ["2", "", "1"])
            self.assertEqual(out["person"].tolist(), ["p1", "p2", "p1"])
            self.assertEqual(out["project"].tolist()[0], "HADOOP")
            text = out.to_csv(index=False)
            self.assertNotIn("Alice", text)
            self.assertNotIn("Secret", text)
            # It reads back as a task history.
            path = Path(d) / "converted.csv"
            out.to_csv(path, index=False)
            done = h.finished(h.read([path]).tasks)
            self.assertEqual(done["key"].tolist(), ["HADOOP-1"])
            self.assertAlmostEqual(done.loc[0, "work_days"], 3 * 5 / 7)

    def test_says_which_column_is_missing(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "issues.csv"
            pd.DataFrame({"key": ["X-1"], "created": ["2020-01-01"]}).to_csv(src, index=False)
            with self.assertRaises(h.HistoryError) as e:
                public.jira(src, MAPPING)
            self.assertRegex(str(e.exception), r"The mapping says “\w+” is the column “\w+”, but the file has no such column\. Columns: key, created")


class EffortTest(unittest.TestCase):
    def test_compares_models_with_function_points(self):
        rng = np.random.default_rng(4)
        n = 81
        points = rng.uniform(50, 800, n)
        df = pd.DataFrame(
            {
                "TeamExp": rng.integers(0, 5, n),
                "ManagerExp": rng.integers(0, 8, n),
                "Length": rng.integers(1, 30, n),
                "Transactions": rng.integers(10, 400, n),
                "Entities": rng.integers(5, 300, n),
                "PointsNonAdjust": points,
                "Adjustment": rng.integers(5, 50, n),
                "PointsAjust": points * rng.uniform(0.8, 1.2, n),
                "Language": rng.choice(["1", "2", "3"], n),
            }
        )
        df["Effort"] = (12 * df["PointsAjust"] * np.exp(rng.normal(0, 0.3, n))).round()
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "desharnais.csv"
            df.to_csv(src, index=False)
            t = public.effort(src)
            names = [r[0] for r in t.rows]
            self.assertEqual(names, ["median effort", "function points", "ridge", "forest", "gbm"])
            fp = next(r for r in t.rows if r[0] == "function points")
            median = next(r for r in t.rows if r[0] == "median effort")
            self.assertLess(float(fp[3][1:]), float(median[3][1:]))  # size explains effort here
            self.assertIn("not Niveloft’s task forecast", t.decision)
            files = t.write(Path(d) / "report")
            self.assertTrue(files[0].read_text(encoding="utf-8").startswith("# Effort estimation on public data"))


    def test_uses_only_what_is_known_when_a_project_is_estimated(self):
        rng = np.random.default_rng(8)
        n = 60
        points = rng.uniform(50, 800, n)
        effort = 12 * points * np.exp(rng.normal(0, 0.3, n))
        team = rng.integers(0, 5, n).astype(float)
        team[[3, 9]] = -1  # the file's marker for "not recorded"
        lines = [
            "@relation desharnais",
            "@attribute Project numeric % proj ID",
            "@attribute TeamExp numeric",
            "@attribute ManagerExp numeric",
            "@attribute YearEnd numeric",
            "@attribute Length numeric % actual schedule: known only at the end",
            "@attribute Effort numeric",
            "@attribute Transactions numeric",
            "@attribute Entities numeric",
            "@attribute PointsNonAdjust numeric",
            "@attribute Adjustment numeric",
            "@attribute PointsAjust numeric",
            "@attribute Language {1,2,3}",
            "@data",
        ]
        for i in range(n):
            lines.append(f"{i + 1},{team[i]:g},{rng.integers(0, 8)},{85 + i % 4},{max(1, round(effort[i] / 400))},{effort[i]:.0f},{rng.integers(10, 400)},{rng.integers(5, 300)},{points[i]:.0f},{rng.integers(5, 50)},{points[i]:.0f},{1 + i % 3}")
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "02.desharnais.arff"
            src.write_text("\n".join(lines) + "\n", encoding="utf-8")
            t = public.effort(src)
            self.assertEqual(t.facts["projects"], n)
            self.assertNotIn("Length", t.facts["inputs"])
            self.assertNotIn("YearEnd", t.facts["inputs"])
            self.assertNotIn("Project", t.facts["inputs"])
            self.assertEqual(t.facts["excluded"], ["Project", "Length", "YearEnd"])
            self.assertEqual(t.facts["missing_values"], {"TeamExp": 2, "ManagerExp": 0})
            self.assertEqual(t.facts["incomplete_projects"], 2)
            self.assertIn("complete_cases", t.facts)
            self.assertEqual(t.facts["complete_cases"]["projects"], n - 2)
            self.assertIn("Length (the actual schedule in months, known only once the project is over)", " ".join(t.notes))
            self.assertRegex(t.notes[0], r"^Source: 02\.desharnais\.arff \([\d,]+ bytes, SHA-256 [0-9a-f]{64}\)\.$")

    def test_refuses_a_spec_that_uses_an_excluded_column(self):
        spec = dict(public.DESHARNAIS, numeric=public.DESHARNAIS["numeric"] + ["Length"])
        with self.assertRaisesRegex(h.HistoryError, "both inputs and excluded: Length"):
            public.effort("unused.csv", spec)


class TabularAndTextTest(unittest.TestCase):
    def test_classifies_a_table_against_the_most_common_class(self):
        rng = np.random.default_rng(5)
        n = 300
        df = pd.DataFrame({"budget": rng.uniform(1, 100, n), "team": rng.integers(2, 20, n), "kind": rng.choice(["a", "b"], n)})
        df["risk"] = np.where(df["budget"] + 3 * df["team"] > 70, "High", "Low")
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "risk.csv"
            df.to_csv(src, index=False)
            t = public.tabular(src, "risk", classify=True, dataset="pm-risk-raw")
            best = max(float(r[2].rstrip("%")) for r in t.rows[1:])
            self.assertGreater(best, 80)
            self.assertIn("Not checked here", t.licence)

    def test_leaves_identifiers_out(self):
        rng = np.random.default_rng(9)
        n = 200
        df = pd.DataFrame({"Project_ID": [f"P{i:04d}" for i in range(n)], "row": np.arange(1, n + 1), "ProjectId2": rng.integers(0, 9, n), "budget": rng.uniform(1, 100, n), "team": rng.integers(2, 20, n)})
        df["risk"] = np.where(df["budget"] > 50, "High", "Low")
        ids = public.identifier_columns(df, "risk")
        self.assertEqual(ids, {"Project_ID": "its name says it identifies a row", "row": "a running number"})
        renamed = public.identifier_columns(df.rename(columns={"Project_ID": "code"}), "risk")
        self.assertEqual(renamed["code"], "a different text value on every row")
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "risk.csv"
            df.to_csv(src, index=False)
            t = public.tabular(src, "risk", classify=True)
            self.assertEqual(set(t.facts["identifiers"]), {"Project_ID", "row"})
            self.assertNotIn("Project_ID", t.facts["inputs"])
            self.assertIn("Left out as identifiers", " ".join(t.notes))
            kept = public.tabular(src, "risk", classify=True, keep=["row"])
            self.assertIn("row", kept.facts["inputs"])

    def test_each_text_once_and_conflicts_out(self):
        df = pd.DataFrame(
            {
                "subject": ["Down", "down ", None, "Refund", "Refund", "Idea", ""],
                "body": ["The site is down", "The  site is DOWN", "Login fails", "Please refund", "please refund", "Dark mode", ""],
                "priority": ["high", "high", "medium", "low", "high", "low", "low"],
            }
        )
        out, info = public.prepare_tickets(df, "subject,body", "priority")
        self.assertEqual(info, {"rows_in_file": 7, "without_text_or_label": 1, "duplicates_removed": 1, "conflicting_rows_removed": 2, "rows": 3})
        self.assertEqual(out["_text"].tolist(), ["Down\nThe site is down", "Login fails", "Idea\nDark mode"])

    def test_versions_of_one_dataset_are_measured_apart(self):
        rng = np.random.default_rng(10)
        words = {"high": "urgent outage down broken asap", "low": "question idea typo wish later"}

        def tickets(start, n):
            rows = []
            for i in range(start, start + n):
                label = "high" if i % 2 else "low"
                rows.append({"subject": f"Ticket {i}", "body": " ".join(rng.choice(words[label].split(), 4)) + f" number {i}", "priority": label, "language": "en" if i % 3 else "de"})
            return pd.DataFrame(rows)

        with tempfile.TemporaryDirectory() as d:
            new, old = Path(d) / "new.csv", Path(d) / "old.csv"
            a = tickets(0, 200)
            a.to_csv(new, index=False)
            pd.concat([a.iloc[:50], tickets(1000, 100)]).to_csv(old, index=False)
            t = public.tickets(new, "subject,body", "priority", compare_with=[old, new])
            self.assertEqual(t.facts["shared_with"], {"old.csv": 50})
            self.assertIn("50 of these tickets (25%) also appear in old.csv", " ".join(t.notes))
            self.assertEqual(set(t.facts["by"]["language"]), {"en", "de"})
            self.assertEqual(t.facts["rows"], 200)

    def test_never_saves_a_model_trained_on_non_commercial_text(self):
        rng = np.random.default_rng(6)
        words = {"High": "urgent outage down broken asap", "Low": "question idea typo wish later"}
        rows = []
        for i in range(200):
            label = "High" if i % 2 else "Low"
            rows.append({"body": " ".join(rng.choice(words[label].split(), 4)) + f" ticket {i}", "priority": label})
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "tickets.csv"
            pd.DataFrame(rows).to_csv(src, index=False)
            t = public.tickets(src, "body", "priority")
            self.assertFalse(t.may_save)
            self.assertIn("no model is saved", t.decision)
            self.assertIn("CC-BY-NC-4.0", t.licence)
            files = t.write(Path(d) / "report")
            self.assertEqual(sorted(p.name for p in Path(d, "report").iterdir()), ["report.json", "report.md"])
            self.assertEqual(len(files), 2)


if __name__ == "__main__":
    unittest.main()
