#!/usr/bin/env bash
# Reruns the kit's tests, then every public experiment on the downloads in one folder.
#   scripts/rerun.sh <folder with the downloads> [output folder] [--risk-target <column>]
# Writes <output>/SUMMARY.md with each source's size and SHA-256. Run from ml/.
set -euo pipefail
cd "$(dirname "$0")/.."
data="${1:?the folder with the downloads (02.desharnais.arff, the ticket CSVs, xlam_function_calling_60k.json)}"
out="${2:-results/public}"
shift $(( $# > 1 ? 2 : 1 ))
python -m unittest discover -s tests -t .
python -m niveloft_ml public all --dir "$data" --out "$out" "$@"
echo "Read $out/SUMMARY.md"
