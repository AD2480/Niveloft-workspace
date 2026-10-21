# Public-data experiments: summary

Run 2026-10-20 11:07 UTC with Python 3.11.15, NumPy 2.4.4, pandas 3.0.2 and scikit-learn 1.8.0. Rerun: `python -m niveloft_ml public all --dir <the folder with these files> --out <folder>`.

These numbers measure classification and estimation on the supplied public datasets. They don't measure Flurry's conversational accuracy, and they don't measure Niveloft's deadline forecast: the first needs the tool-calling eval against a live model, the second your own exported history.

## Sources

| File | Size | Rows | Used for | SHA-256 |
|---|---:|---:|---|---|
| xlam_function_calling_60k.json | 96,116,570 | 60,000 | tool-calling sample | `4ef5c6f0dc552f2231f93f5853a9ef431e9e806d7aa514d0f6b615606ce576c6` |
| 02.desharnais.arff | 7,772 | 81 | effort estimation | `55d7786b24da2073e48c620df6aef5e206e7113f0e871629d1047c4be9c2b06e` |
| aa_dataset-tickets-multi-lang-5-2-50-version.csv | 25,996,354 | 28,587 | ticket priority | `f187c090e59581c2bbf3aa1377c8db4dd647464ecf2ae51bf8966e42e0ed6bc0` |
| dataset-tickets-multi-lang-4-20k.csv | 18,799,808 | 20,000 | ticket priority | `9be3bf810584fe01e8e83383e83dfd33f4c3910938ecad03ef151da79d8f0635` |
| dataset-tickets-german_normalized_50_5_2.csv | 8,327,422 | 13,178 | ticket priority | `22580337aed864d8c0485f16a7fe683d48d8adfc3af0cd1a6fe1e240f728735f` |

## xLAM Function Calling 60K

Every record was read and checked: **58,369 of 60,000 can be scored**. The rest have problems a scorer can't settle (260 where two tools share a name; 275 where an expected call leaves out a required argument; 1,125 where an expected value isn't of the declared kind; a record can have more than one). A fixed sample of 200 usable records (95 simple, 63 multiple, 37 parallel, 5 parallel multiple) is stored as ids and the file's SHA-256 in `ml/eval_cases/xlam-sample.json`; `python -m niveloft_ml tools --xlam <your download>` scores exactly those records when the hash matches.

What it means: a model's general function calling can be measured before any fine-tuning. Flurry hasn't been trained on these records, and nothing here says how well Flurry answers questions about a project. [Report](xlam/check.md)

## Desharnais software effort

81 projects, read from the PROMISE ARFF file. Inputs are only what's known when a project is estimated (TeamExp, ManagerExp, Transactions, Entities, PointsNonAdjust, Adjustment, PointsAjust, Language); Project, Length, YearEnd are never inputs (an identifier, the actual schedule, the end year). The file's -1 markers became missing values in 4 projects, filled inside each training fold.

Typical miss (geometric mean of actual ÷ predicted, either way): function-point regression ×1.59, best model ridge ×1.42. Ridge beats function points: 24% of its typical miss removed, ahead in 100% of resamples. On the 77 complete projects alone: best ridge ×1.42 against ×1.60.

What it means: a comparison of methods on whole projects from the 1980s, free of the schedule-length leak. It isn't Niveloft's task forecast. [Report](effort/report.md)

## Multilingual customer support tickets

Priority predicted from the subject and body, by 5-fold stratified cross-validation. Each file is a version of one dataset and they share tickets, so each is measured on its own and never pooled (pooling would put the same ticket in training and test).

- **aa_dataset-tickets-multi-lang-5-2-50-version.csv**, the newest release, 5.2, in English and German: 28,586 tickets after removing 1 repeated text; 3 priority levels. Best: words (tf-idf) + logistic regression, **balanced accuracy 60%** (accuracy 60%, macro F1 0.59) against 33% for always guessing the most common level; by language de 53%, en 65%. Shares 8,308 tickets with dataset-tickets-multi-lang-4-20k.csv, so it was measured on its own. [Report](tickets-multi-lang-5-2-50-version/report.md)
- **dataset-tickets-multi-lang-4-20k.csv**, an earlier release of 20,000 tickets: 20,000 tickets (none repeated); 3 priority levels. Best: words (tf-idf) + logistic regression, **balanced accuracy 52%** (accuracy 53%, macro F1 0.52) against 33% for always guessing the most common level; by language de 47%, en 56%. Shares 8,308 tickets with aa_dataset-tickets-multi-lang-5-2-50-version.csv, so it was measured on its own. [Report](tickets-multi-lang-4-20k/report.md)
- **dataset-tickets-german_normalized_50_5_2.csv**, a German-only release with five priority levels: 13,178 tickets (none repeated); 5 priority levels. Best: characters (tf-idf) + logistic regression, **balanced accuracy 92%** (accuracy 92%, macro F1 0.92) against 20% for always guessing the most common level; by language de 92%. Read this score with care: these synthetic texts often state the urgency in words (dringend, kritisch, sofort appear mostly in high and critical tickets), which the generator wrote to match the label. The score shows the generator was consistent, not that real tickets are this predictable. [Report](tickets-german_normalized_50_5_2/report.md)

What it means: a reproducible priority-classification benchmark on synthetic tickets. The licence is CC-BY-NC-4.0, so no model trained on it is saved or shipped. It isn't a measure of anything in Niveloft.

## Not run

- Project Management Risk Raw: no file with “risk” in its name in this folder, so it wasn't run. Add it and rerun with `--risk-target <column>`.

## Licences

- Support tickets: CC-BY-NC-4.0 (the creator's current Hugging Face release). Experiments only; don't assume commercial training is allowed.
- xLAM Function Calling 60K: CC-BY-4.0, after accepting the dataset's access conditions on Hugging Face. The records aren't copied into this repository.
- Desharnais (PROMISE repository) and Project Management Risk Raw: licences not checked here; read the sources before any use beyond research.
