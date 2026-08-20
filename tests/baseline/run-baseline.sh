#!/usr/bin/env bash
# Double-run behavioural baseline: capture every case twice, normalise, hash,
# and prove determinism (run1 hash == run2 hash). Emits baseline-hashes.json.
set -euo pipefail
cd "$(dirname "$0")"
BASE="$PWD"

echo "=== capture run 1 ==="
rm -rf "$BASE/run1"
CAPTURE_DIR="$BASE/run1" node "$BASE/capture.mjs" 2>&1 | grep -E '^OK|^FAIL' || true

echo "=== capture run 2 ==="
rm -rf "$BASE/run2"
CAPTURE_DIR="$BASE/run2" node "$BASE/capture.mjs" 2>&1 | grep -E '^OK|^FAIL' || true

echo "=== normalize + compare ==="
python3 - "$BASE" <<'PY'
import os, sys, subprocess, json
base = sys.argv[1]
rows = []
mismatches = []
missing = []
for slug in sorted(os.listdir(os.path.join(base, "run1"))):
    d1 = os.path.join(base, "run1", slug)
    d2 = os.path.join(base, "run2", slug)
    if not os.path.isdir(d1):
        continue
    for f in sorted(os.listdir(d1)):
        if not f.endswith(".out"):
            continue
        p1 = os.path.join(d1, f)
        p2 = os.path.join(d2, f)
        if not os.path.exists(p2):
            missing.append(f"{slug}/{f}")
            continue
        o1 = subprocess.check_output(["python3", os.path.join(base, "normalize.py"), p1]).decode().strip().split()
        o2 = subprocess.check_output(["python3", os.path.join(base, "normalize.py"), p2]).decode().strip().split()
        rows.append({"tool": slug, "case": f[:-4], "hash": o1[0], "size": int(o1[1]), "pages": int(o1[2])})
        if o1[0] != o2[0]:
            mismatches.append(f"{slug}/{f[:-4]}")

print(f"\ncases: {len(rows)}  mismatches: {len(mismatches)}  missing-in-run2: {len(missing)}")
for r in rows:
    print(f"{r['tool']:<20} {r['case']:<12} {r['size']:>8} {r['pages']:>4}  {r['hash']}")
if mismatches:
    print("\nMISMATCHES:", *mismatches, sep="\n  ")
if missing:
    print("\nMISSING IN RUN2:", *missing, sep="\n  ")
json.dump({"results": rows, "mismatches": mismatches, "missing": missing},
          open(os.path.join(base, "baseline-hashes.json"), "w"), indent=2)
print("\nwrote baseline-hashes.json")
PY
