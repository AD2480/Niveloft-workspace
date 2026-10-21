# xLAM Function Calling 60K: every record checked

> Salesforce xLAM Function Calling 60K. Licence: CC-BY-4.0, after accepting the dataset’s access conditions on Hugging Face. The records stay in your download; this report holds counts and ids only.

**58,369 of 60,000 records can be scored** (1,631 can’t).

| Problem | Records |
|---|---:|
| its tools or answers aren't valid JSON | 0 |
| it has no question | 0 |
| a tool has no name, or its parameters aren't described | 0 |
| two tools share a name | 260 |
| it has no expected call | 0 |
| an expected call has no name, or its arguments aren't an object | 0 |
| an expected call uses a function the record doesn't offer | 0 |
| an expected call passes an argument the function doesn't declare | 0 |
| an expected call leaves out a required argument | 275 |
| an expected value isn't of the declared kind | 1,125 |

A record can have more than one problem. Example ids for each problem are in check.json.

## Usable records by the shape of their expected calls

| Shape | Records |
|---|---:|
| simple | 27,719 |
| multiple | 18,326 |
| parallel | 10,895 |
| parallel multiple | 1,429 |

## The fixed sample

200 usable records, seed 7: 95 simple, 63 multiple, 37 parallel, 5 parallel multiple.

## What this doesn’t check

- Whether an expected argument’s value is what the question asked for. APIGen checked that when it made the data (its authors report above 95% correct in a human review of 600 records); this report only checks structure and kinds.
- Types it can’t check (Callable, Union) are taken as they are.

Source: xlam_function_calling_60k.json, SHA-256 4ef5c6f0dc552f2231f93f5853a9ef431e9e806d7aa514d0f6b615606ce576c6.
