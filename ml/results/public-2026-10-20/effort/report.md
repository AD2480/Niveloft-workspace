# Effort estimation on public data

> Desharnais software effort (81 projects, from the PROMISE repository). Licence: Not checked here: read the source before use. Commercial use: unknown. Effort is in person-hours for whole projects, not tasks. Project, Length and YearEnd are never inputs: an identifier, and two things known only once a project is over. -1 means not recorded. PROMISE asks that work using it follow its acknowledgement guidelines.

## The decision

Ridge beats function points: 24% of its typical miss removed, ahead in 100% of resamples. This is research on whole projects, not Niveloft’s task forecast: use it to judge methods, not to replace the forecast.

## The setup

81 projects, 5-fold cross-validation repeated 3 times (there are no dates to split on). Inputs: TeamExp, ManagerExp, Transactions, Entities, PointsNonAdjust, Adjustment, PointsAjust, Language. Models predict log effort; misses are in the target’s units (Effort).

## Results

| Method | Median miss | Mean miss | Typical miss | Within ±25% | Against function points |
|---|---:|---:|---:|---:|---:|
| median effort | 1715.0 | 2910.7 | ×1.92 | 26% | -40% (-51% to -29%), ahead in 0% |
| function points | 1106.6 | 2137.4 | ×1.59 | 33% | (the baseline) |
| ridge | 1251.0 | 1905.7 | ×1.42 | 37% | +24% (+16% to +31%), ahead in 100% |
| forest | 1171.7 | 2063.8 | ×1.52 | 35% | +10% (+4% to +14%), ahead in 100% |
| gbm | 1076.5 | 2002.3 | ×1.49 | 30% | +14% (+7% to +20%), ahead in 100% |

## Notes

- Source: 02.desharnais.arff (7,772 bytes, SHA-256 55d7786b24da2073e48c620df6aef5e206e7113f0e871629d1047c4be9c2b06e).
- Never used as inputs: Project (an identifier, not a property of the work); Length (the actual schedule in months, known only once the project is over); YearEnd (the year the project ended, known only at the end).
- Missing values: 2 in TeamExp, 3 in ManagerExp (written as -1 in the file), across 4 projects; each is filled with the median of the training projects in its fold.
- With only the 77 projects that have nothing missing: best ridge, typical miss ×1.42 against ×1.60 for function points (+24% of its miss, ahead in 100% of resamples).
