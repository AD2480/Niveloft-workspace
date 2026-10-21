import math
import tempfile
import unittest
from pathlib import Path

from niveloft_ml import arff

SAMPLE = """% A comment line
@relation 'effort data'

@attribute Project numeric       % proj ID
@attribute 'Team Exp' numeric    % measured in years
@attribute Name string
@attribute Language {1,2,3}      % categorical
@attribute Notes string

@data
% data comments are skipped too
1,4,'Payroll, phase 1',1,"a % sign, kept"
2,?,Ledger,2,'it\\'s fine'
3, -1 , 'Spaced' ,3,?
"""


class ArffTest(unittest.TestCase):
    def read(self, text: str):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.arff"
            p.write_text(text, encoding="utf-8")
            return arff.read(p)

    def test_reads_types_quotes_comments_and_missing_values(self):
        t = self.read(SAMPLE)
        self.assertEqual(list(t.columns), ["Project", "Team Exp", "Name", "Language", "Notes"])
        self.assertEqual(t["Project"].tolist(), [1.0, 2.0, 3.0])
        self.assertTrue(math.isnan(t.loc[1, "Team Exp"]))  # ? is missing
        self.assertEqual(t.loc[2, "Team Exp"], -1.0)  # a dataset's own marker is left for the experiment to interpret
        self.assertEqual(t["Name"].tolist(), ["Payroll, phase 1", "Ledger", "Spaced"])
        self.assertEqual(t["Language"].tolist(), ["1", "2", "3"])  # nominal values stay labels
        self.assertEqual(t.loc[0, "Notes"], "a % sign, kept")
        self.assertEqual(t.loc[1, "Notes"], "it's fine")
        self.assertTrue(isinstance(t.loc[2, "Notes"], float) and math.isnan(t.loc[2, "Notes"]))
        self.assertEqual(t.attrs["arff_types"]["Language"], "nominal")

    def test_refuses_what_it_would_misread(self):
        with self.assertRaisesRegex(arff.ArffError, "sparse ARFF"):
            self.read("@relation r\n@attribute a numeric\n@data\n{0 1}\n")
        with self.assertRaisesRegex(arff.ArffError, "2 values for 1 attributes"):
            self.read("@relation r\n@attribute a numeric\n@data\n1,2\n")
        with self.assertRaisesRegex(arff.ArffError, "line 1: expected @relation, @attribute or @data"):
            self.read("a,b\n1,2\n")
        with self.assertRaisesRegex(arff.ArffError, "not an ARFF file"):
            self.read("% only a comment\n")

    def test_reads_csv_through_the_same_door(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.csv"
            p.write_text("a,b\n1,x\n", encoding="utf-8")
            self.assertEqual(arff.read_table(p)["b"].tolist(), ["x"])


if __name__ == "__main__":
    unittest.main()
