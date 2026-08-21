#!/usr/bin/env python3
"""Corpus check for the structured PDF -> Word converter.

For every corpus PDF it runs scripts/pdf2word-structured.py, then asserts the
OOXML contains the structural constructs the captain's bar requires:

  * a non-empty set of w:pStyle values (headings / title),
  * at least one w:numPr where the source has a list,
  * at least one w:tbl where the source has a table,
  * exit code 3 for a scanned PDF with no text layer.

Exits non-zero if any assertion fails, so it can gate CI.

Usage (from repo root):
    python3 tests/pdf2word/check.py
"""

import io
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CORPUS = Path(__file__).resolve().parent / "corpus"
MANIFEST = Path(__file__).resolve().parent / "corpus-manifest.json"
CONVERTER = ROOT / "scripts" / "pdf2word-structured.py"


def ooxml_counts(docx_bytes):
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as z:
        document = z.read("word/document.xml").decode("utf-8", "replace")
    pstyles = set(re.findall(r'w:pStyle w:val="([^"]+)"', document))
    # Count only paragraph-level numPr (document.xml): a list item must carry
    # its own numbering. Style-level numPr would mask a converter that failed
    # to emit lists.
    numpr = document.count("w:numPr")
    tables = document.count("<w:tbl>")
    return pstyles, numpr, tables


def run_converter(pdf_path):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.docx"
        proc = subprocess.run(
            [sys.executable, str(CONVERTER), str(pdf_path), str(out)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode != 0:
            return proc.returncode, None, proc.stderr
        return proc.returncode, out.read_bytes(), proc.stderr


def main():
    manifest = json.loads(MANIFEST.read_text())
    failures = []
    rows = []

    for entry in manifest["files"]:
        name = entry["name"]
        pdf = CORPUS / name
        code, out, stderr = run_converter(pdf)

        if entry.get("expect_exit_3"):
            ok = code == 3
            rows.append((name, "scanned (expect exit 3)", f"exit {code}", "PASS" if ok else "FAIL"))
            if not ok:
                failures.append(f"{name}: expected exit 3, got {code}")
            continue

        if code != 0:
            rows.append((name, "convert", f"exit {code}: {stderr.strip()[:80]}", "FAIL"))
            failures.append(f"{name}: converter exited {code}: {stderr.strip()}")
            continue

        pstyles, numpr, tables = ooxml_counts(out)

        if entry.get("has_heading"):
            ok_styles = len(pstyles) > 0
        else:
            ok_styles = True  # no heading required

        ok_list = not entry.get("has_list") or numpr > 0
        ok_table = not entry.get("has_table") or tables > 0

        problems = []
        if not ok_styles:
            problems.append("no w:pStyle")
        if not ok_list:
            problems.append("no w:numPr")
        if not ok_table:
            problems.append("no w:tbl")

        status = "PASS" if not problems else "FAIL"
        detail = f"styles={sorted(pstyles) or 'NONE'} numPr={numpr} tbl={tables}"
        if problems:
            detail += f" MISSING={','.join(problems)}"
        rows.append((name, "structure", detail, status))
        if problems:
            failures.append(f"{name}: {', '.join(problems)}")

    # Print a comparison table.
    print(f"{'file':28} {'check':16} {'result':30} status")
    for name, kind, detail, status in rows:
        print(f"{name:28} {kind:16} {detail:30} {status}")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"\nAll {len(manifest['files'])} corpus files passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
