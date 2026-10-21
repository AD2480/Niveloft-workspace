"""A small reader for dense ARFF files (Weka's format, used by the PROMISE repository).

ARFF is a header of ``@attribute`` lines followed by comma-separated ``@data`` rows. This reads
what the PROMISE effort datasets use: numeric, integer, real, string, date and nominal ({a,b})
attributes, ``%`` comments (whole lines, and after an attribute), quoted names and values, and
``?`` for a missing value. Sparse ARFF (rows in braces) is refused with a clear message rather
than misread.

Values a dataset uses as its own missing marker (Desharnais writes -1) are left as they are here:
the experiment that knows the dataset decides what they mean.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd


class ArffError(ValueError):
    pass


_NUMERIC = {"numeric", "real", "integer"}


def _strip_comment(line: str) -> str:
    """The line without a trailing % comment (a % inside quotes or braces is kept)."""
    quote, depth, escaped = "", 0, False
    for i, ch in enumerate(line):
        if quote:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth = max(0, depth - 1)
        elif ch == "%" and depth == 0:
            return line[:i]
    return line


def _split(line: str) -> list[str]:
    """Comma-separated values, with ' or " quotes and backslash escapes inside them."""
    out, cur, quote, quoted, i = [], [], "", False, 0
    while i < len(line):
        ch = line[i]
        if quote:
            if ch == "\\" and i + 1 < len(line):
                cur.append(line[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = ""
            else:
                cur.append(ch)
        elif ch in "'\"" and not "".join(cur).strip():
            quote, quoted, cur = ch, True, []
        elif ch == ",":
            out.append(("".join(cur), quoted))
            cur, quoted = [], False
        elif quoted and ch.isspace():
            pass  # spaces between a closing quote and the comma
        else:
            cur.append(ch)
        i += 1
    if quote:
        raise ArffError(f"an unclosed quote in: {line[:80]}")
    out.append(("".join(cur), quoted))
    return [v if q else v.strip() for v, q in out]


def _name_and_type(rest: str) -> tuple[str, str]:
    rest = rest.strip()
    if rest[:1] in "'\"":
        q = rest[0]
        end = rest.find(q, 1)
        if end < 0:
            raise ArffError(f"an unclosed quote in the attribute: {rest[:80]}")
        return rest[1:end], rest[end + 1 :].strip()
    m = re.match(r"(\S+)\s+(.*)$", rest)
    if not m:
        raise ArffError(f"an attribute without a type: {rest[:80]}")
    return m.group(1), m.group(2).strip()


def read(path: str | Path) -> pd.DataFrame:
    """The ARFF file as a table: numeric attributes as floats (missing as NaN), others as text."""
    names: list[str] = []
    kinds: list[str] = []
    nominal: dict[str, list[str]] = {}
    rows: list[list[str]] = []
    in_data = False
    for n, raw in enumerate(Path(path).read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("%"):
            continue
        if not in_data:
            line = _strip_comment(line).strip()
            if not line:
                continue
            low = line.lower()
            if low.startswith("@relation"):
                continue
            if low.startswith("@attribute"):
                name, typ = _name_and_type(line[len("@attribute") :])
                if typ.startswith("{"):
                    values = _split(typ.strip()[1:].rstrip("}"))
                    nominal[name] = values
                    kinds.append("nominal")
                else:
                    kinds.append(typ.split()[0].lower())
                names.append(name)
                continue
            if low.startswith("@data"):
                in_data = True
                continue
            raise ArffError(f"line {n}: expected @relation, @attribute or @data, found: {line[:60]}")
        if line.startswith("{"):
            raise ArffError(f"line {n}: sparse ARFF rows aren't supported; convert the file to dense ARFF or CSV first")
        values = _split(line)
        if len(values) != len(names):
            raise ArffError(f"line {n}: {len(values)} values for {len(names)} attributes")
        rows.append(values)
    if not names:
        raise ArffError("no @attribute lines: not an ARFF file")
    if not in_data:
        raise ArffError("no @data section")
    table = pd.DataFrame(rows, columns=names, dtype=object)
    for name, kind in zip(names, kinds):
        col = table[name].map(lambda v: None if v in ("?", "") else v)
        if kind in _NUMERIC:
            table[name] = pd.to_numeric(col, errors="coerce").astype(float)
        else:
            table[name] = col.astype(object).where(col.notna(), np.nan)
    table.attrs["arff_types"] = dict(zip(names, kinds))
    table.attrs["arff_nominal"] = nominal
    return table


def read_table(path: str | Path) -> pd.DataFrame:
    """An .arff file through :func:`read`, anything else as CSV."""
    return read(path) if str(path).lower().endswith(".arff") else pd.read_csv(path)
