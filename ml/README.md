# Training a better deadline forecast, and measuring Flurry's model

Two tools for deciding, with numbers, whether a change to Niveloft's AI is worth making:

1. **The forecast kit** trains deadline predictions on your own completed-task history and tests
   them against Niveloft's current forecast on later work. It recommends a model only when it
   beats the forecast by a margin, reliably; otherwise it says to keep the forecast.
2. **The tool-calling eval** measures a model on Flurry's tools (and, if you like, on a sample of
   Salesforce's xLAM function-calling data) before anyone considers fine-tuning one.

Neither changes the app. A recommended model is a file and a report; putting it into Niveloft is a
separate, deliberate step (see [After a model wins](#after-a-model-wins)).

```bash
cd ml
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt          # pandas, NumPy, scikit-learn, joblib
python -m unittest discover -s tests -t .
```

Python 3.10 or later. Tested with Python 3.11, pandas 3.0, NumPy 2.4 and scikit-learn 1.8.

## 1. Your own history

**Get the file.** In Niveloft, a project's owners and managers have *Project settings → Forecast
training data → Download CSV* (or `GET /api/projects/{id}/export/task-history.csv` with their
token). It holds what a forecast learns from and nothing anyone wrote:

| Column | What it is |
| --- | --- |
| `project`, `task` | The project key and the task key (ONB, ONB-9) |
| `status`, `priority`, `estimate_days` | As in the app; the estimate is in working days, empty when there's none |
| `person` | The owner as `p1`, `p2`, …, numbered in the order they first own a task in this file. Not a name, and not stable between downloads |
| `created_at`, `started_at`, `approved_at` | When it was created, first moved to In progress, and approved (UTC) |
| `blockers_approved_at` | When everything it waits on was approved (empty if it waits on nothing, or on work not approved yet) |
| `last_review_at` | The last time it went to review (before its approval) |
| `due_date` | Its due date, if any |
| `waits_on`, `holds_up` | How many tasks it waits on, and how many wait on it |
| `criteria`, `checklist`, `description_chars` | How many acceptance criteria and checklist items it has, and how long its description is (not the text) |
| `submissions`, `changes_requested` | Outcomes, known only after the work: used for analysis, never to predict |

**Run it.**

```bash
python -m niveloft_ml train --data ONB-task-history-v1.csv --data CCP-task-history-v1.csv --out ml-report
```

You get `ml-report/report.md` (read this), `report.json`, and only when a model wins, `model.joblib`
(for Python) and `model.json` (the same model for Niveloft's server, which has no Python).

**What's predicted.** The same thing Niveloft's forecast predicts (`workDays` in
`frontend/src/lib/progressForecast.ts`): working days from when a task could really proceed (it had
started, and everything it waited on was approved) to its final submission for review. Waiting for
the review is separate.

**What it's compared with.**
- *The estimate as written* (or the project's typical estimate when there's none).
- *Niveloft's current forecast*: the estimate times the person's learned pace, pulled towards the
  project's pace until they have a few finished tasks. The kit recomputes it exactly as the app
  does, from only the work approved before each task started.
- *Candidates*: ridge regression, a random forest, gradient-boosted trees, and a *correction* model
  that learns what Niveloft's forecast tends to miss and adds it. With `--with xgboost,autogluon`
  (after `pip install -r requirements-extra.txt`), XGBoost and AutoGluon Tabular too.

**How it's tested.** As a replay: the models are trained on the tasks approved up to a cut-off date,
as if built that day, and forecast the tasks that started after it. Tasks in flight at the cut-off
are left out of both, and every feature uses only what was recorded before the task could start,
so nothing a model sees comes from its own future.

**The decision.** A model is recommended only when, on the later tasks, it removes at least 5% of
Niveloft's typical miss *and* comes out ahead in at least 95% of 2,000 bootstrap resamples of those
tasks. With fewer than 60 tasks to learn from or 30 to test on, it doesn't try: it says how many it
has and to come back later. Change these with `--min-gain`, `--min-train`, `--min-test`.

The report also says how often Niveloft's 80% ranges held the actual times (they should hold about
80%), and how much better the current forecast is than the raw estimates.

**Try it first on made-up data.**

```bash
python -m niveloft_ml synthetic --out SYN-task-history-v1.csv            # effects the forecast doesn't model
python -m niveloft_ml train --data SYN-task-history-v1.csv --out syn-report
python -m niveloft_ml synthetic --plain --out SYN-plain.csv              # nothing to learn beyond the forecast
python -m niveloft_ml train --data SYN-plain.csv --out plain-report      # → keep Niveloft's forecast
```

Synthetic files are for project `SYN`, and every report made from them says so at the top: their
numbers describe the generator, not a team. On the default synthetic data a model wins (about 15%
of the typical miss removed); on `--plain` data it doesn't, and the kit says to keep the forecast.
On the sample projects the tests use there are far too few finished tasks, and it says that too.

### After a model wins: the trial

A model that won on past work still has to win on new work, so it goes on trial beside Niveloft's
forecast rather than replacing it:

1. Copy `model.json` to the server and set `FORECAST_MODEL_FILE` to its path, then restart. The
   server checks the file when it starts (the schema, that it was trained on Niveloft task history,
   the same features in the same order) and refuses anything it can't run faithfully, saying why in
   its log and on the page. A model trained on the kit's made-up data is refused unless
   `FORECAST_MODEL_ALLOW_SYNTHETIC=true` (for trying the trial on a test server only).
2. On the Delivery page, members see *Forecast model trial*: for each task in progress that can
   proceed, Niveloft's forecast of its work and the model's, side by side. The server records both
   the first time it makes them (`forecast_trial`, numbers only) and never rewrites them; once the
   work is submitted it records what it really took. Work that could only start after the model
   was trained but finished before anyone looked is scored too, marked *checked after the fact*.
3. The page says how each forecast did so far (typical miss, and which was closer how often) and,
   before about 30 tasks forecast in advance have been submitted, that it's too early to tell.
   Niveloft's forecast stays the one the app uses. Switching is your decision after the trial.
4. To stop it, switch off *the forecast model trial* in Site health (or remove the setting).
   Nothing else changes; the records stay, under that model's id.

The server builds the same features as `niveloft_ml/features.py`, in Java
(`backend/.../forecast/WorkDayFeatures.java`), and runs all four built-in kinds of model (ridge,
gbm, correction, forest; XGBoost and AutoGluon don't export). A test checks it against this kit's
own numbers on the same file: every feature and every prediction of every kind, on finished work
and work in progress (`scripts/forecast_parity_fixture.py` writes the fixture). Retrain and retest
whenever the team or the kind of work changes; a new `model.json` starts a new trial.

## 2. Public data, for first experiments

Before your own history is big enough, public datasets show which methods are worth trying. Their
licences decide what you may do with a model trained on them: `python -m niveloft_ml datasets`
lists them (from `datasets.json`), and a model trained on data marked non-commercial is never saved.

**Everything at once.** Put the downloads in one folder and run:

```bash
python -m niveloft_ml public all --dir ~/Downloads/niveloft-data --out results/public
# or: scripts/rerun.sh ~/Downloads/niveloft-data results/public   (tests first, then the run)
```

It finds the Desharnais ARFF, the ticket CSVs, the xLAM JSON and a risk CSV by their names and
columns, runs what applies, and writes `SUMMARY.md` with each source's size and SHA-256, so a rerun
can be checked against the same files. `--risk-target <column>` runs the risk table; `--reuse` reads
back reports already in `--out` for files with the same hash (the ticket models take minutes).

**The results of 20 October 2026** are in [`results/public-2026-10-20/SUMMARY.md`](results/public-2026-10-20/SUMMARY.md),
run on the downloads attached that day (no data is stored here):

| Data | What was done | Result |
| --- | --- | --- |
| xLAM Function Calling 60K | Every record checked; a fixed sample of 200 drawn | 58,369 of 60,000 can be scored; the 1,631 others have two tools with one name, a required argument left out, or a value of another kind than declared. The sample is `eval_cases/xlam-sample.json` (ids and the file's hash only) |
| Desharnais (PROMISE ARFF) | Read as ARFF; -1 treated as missing; Project, Length and YearEnd never inputs | Ridge regression's typical miss ×1.42 against ×1.59 for the function-point regression (24% less, ahead in every resample) |
| Support tickets, newest release | 28,586 tickets (one repeated text removed), priority from subject and body | Balanced accuracy 60% against 33% for guessing; English 65%, German 53% |
| Support tickets, earlier release | Measured apart: it shares 8,308 tickets with the newest | Balanced accuracy 52% |
| Support tickets, German five-level release | Measured apart | 92%, but the synthetic texts often state the urgency in words, so this shows the generator's consistency |
| Project Management Risk Raw | Not run: the file wasn't attached this time | `public tabular --data risk.csv --target <column> --classify` leaves identifier columns out |

These numbers are about the public datasets. They don't measure Flurry's answers (that's the
tool-calling eval against a live model) or Niveloft's deadline forecast (that's your own history).

| Dataset | Command | Licence, as recorded |
| --- | --- | --- |
| Apache Jira Issues (Kaggle) | `public jira --data issues.csv --mapping examples/jira-mapping.json` | Not checked here: read the dataset page |
| Project Management Risk Raw (Kaggle) | `public tabular --data risk.csv --target <column> --classify` | Not checked here |
| Multilingual Customer Support Tickets | `public tickets --data <file> --text subject,body --label priority` | **CC-BY-NC-4.0** on the creator's current Hugging Face release: don't assume it permits commercial training |
| Desharnais effort data (PROMISE; the Kaggle notebook uses it) | `public effort --data 02.desharnais.arff` (ARFF or CSV) | Not checked here; PROMISE asks for acknowledgement |
| Salesforce xLAM Function Calling 60K | `xlam --data …`, `tools --xlam …` and `sft --xlam …` (below) | **CC-BY-4.0**, and you must accept its access conditions on Hugging Face |

- **Jira** exports name their columns differently: edit `examples/jira-mapping.json` to match your
  file. Jira has no start or review dates, so the time compared is created → resolved, queue time
  included. Names and text are dropped in the conversion, as in Niveloft's own export.
- **Effort** reads the PROMISE ARFF file directly (or a CSV) and compares models with the classic
  function-point regression by repeated cross-validation. Inputs are only what's known when a
  project is estimated: `Length` (the actual schedule, a result like effort itself), `YearEnd` (when
  it ended) and `Project` (an id) are never inputs. The file writes -1 for "not recorded"; those
  become missing values, filled from the training projects of each fold, and the report repeats the
  comparison on the complete projects alone. It's research on whole projects, not Niveloft's task
  forecast.
- **Tickets** compares word and character TF-IDF with logistic regression against always guessing
  the most common label. `--text subject,body` joins columns. Each text is kept once (case and
  spacing ignored), and a text that appears with different labels is left out entirely. Several
  `--data` files are measured one by one, never pooled: the creator's releases share thousands of
  tickets, and pooling them would put the same ticket in training and in test. The best method is
  broken down by language.
- **Tabular** leaves out identifier columns (named like `Project_ID` or `id`, a running number, or a
  different text on every row) and says which; `--keep` keeps one.

The adapters are tested on small made-up files, and were run on the real downloads listed above.

## 3. Measuring a model on Flurry's tools

Run Niveloft's cases against any OpenAI-compatible API: OpenAI, Groq, OpenRouter, vLLM serving
Qwen3 or an xLAM model, Ollama, LM Studio. The key is read from an environment variable and never
written anywhere.

```bash
# Qwen3 in Ollama on this computer
python -m niveloft_ml tools --base-url http://localhost:11434/v1 --model qwen3:8b --out tools-qwen3

# a hosted model
export AI_API_KEY=…   # the provider's key
python -m niveloft_ml tools --base-url https://api.groq.com/openai/v1 --model <model id> --out tools-groq
```

The 26 cases in `eval_cases/flurry-tools.jsonl` use Flurry's real instructions
(`eval_cases/flurry-instructions.txt`, kept identical to the server's by a backend test), the
server's own tool list (`backend/src/main/resources/ai/tools.json`), and a sample project summary.
They check that the model:

- looks up what the summary doesn't hold (descriptions, criteria, comments, reviews, mentions,
  activity), with the right arguments, and doesn't look up what the summary already answers;
- suggests creating or starting a task only through the proposal tools, and never claims it's done;
- refuses what no tool can do (approve, assign, reschedule, delete), without inventing a tool;
- treats an empty lookup as unknown, not as a finding, and stays out of other projects;
- ignores instructions written inside a record;
- answers in a form the server can read.

Where a case scripts the tools' replies, the conversation continues and the answer is checked too.
`results.md` lists passes by kind and by check, and why each failure failed. Replies vary between
runs, so run twice before reading much into one case.

**General function calling, on xLAM.** Download the dataset from Hugging Face after accepting its
terms. First check it:

```bash
python -m niveloft_ml xlam --data xlam_function_calling_60k.json --out xlam-check
```

Every record is read and checked: the expected calls must use functions the record offers, with
arguments those functions declare, the required ones present, and values of the declared kinds. On
the release of 20 October 2026 (SHA-256 `4ef5c6f0…c576c6`), 58,369 of 60,000 pass. The fixed
evaluation sample, 200 records stratified by the shape of their expected calls (95 single calls, 63
several functions, 37 one function several times, 5 both), is drawn only from those and kept in
`eval_cases/xlam-sample.json` as ids and the file's hash, never as records. Then score a model:

```bash
python -m niveloft_ml tools --xlam xlam_function_calling_60k.json --base-url … --model …
```

With the same file (the hash matches) it scores exactly the fixed 200; with another file or
`--sample`, a seeded random sample, and the result says which. It reports the share of examples with
exactly the right calls (any order, values compared loosely for numbers) and with the right
functions.

### Fine-tuning, only if the numbers call for it

Start with a pretrained model and Niveloft's tools. Consider fine-tuning only if the eval shows a
gap that matters for Flurry and a better hosted or open model doesn't close it. If it comes to that:

1. Make training data that isn't the test. `python -m niveloft_ml sft --xlam … --out train.jsonl`
   writes xLAM examples as tool-calling conversations (`{"messages": [...], "tools": [...]}`), the
   format Hugging Face chat templates and TRL's `SFTTrainer` read. Never add `eval_cases/` to it.
2. Fine-tune with LoRA adapters (Hugging Face PEFT) through TRL's `SFTTrainer`, on a GPU. This kit
   doesn't include or run a training script: the libraries' APIs change between versions, so follow
   their current documentation for the model you choose, and check that model's own licence.
3. Run the same eval on the base model and the tuned one, and adopt the tuned one only if it's
   better without being worse on any kind of case.

## What ran where

In this repository's checks: all of the Python tests (`python -m unittest discover -s tests -t .`),
on synthetic data, small made-up files shaped like the public datasets, and stand-in model servers
on this computer; and, on 20 October 2026, the public downloads listed in section 2 (xLAM, the
Desharnais ARFF and three ticket files). The `model.json` the kit writes was checked against the
server's own code for all four kinds of model, on the same file (3,325 features and 700 predictions;
largest difference 8.9e-16). Not run: XGBoost, AutoGluon, the risk table (not attached), any real
model behind the eval, a model trained on a real team's history, and any fine-tuning.
