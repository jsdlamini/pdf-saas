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

echo "=== compare (hash + SSIM) ==="
python3 "$BASE/report.py" "$BASE"
