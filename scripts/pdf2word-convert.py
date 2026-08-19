#!/usr/bin/env python3
"""Layout-preserving PDF -> DOCX conversion backed by pdf2docx (PyMuPDF + python-docx).

Usage:
    python3 pdf2word-convert.py <input.pdf> <output.docx>

Exits non-zero on any failure so the calling process can detect the error and
fall back to another engine.
"""

import sys


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: pdf2word-convert.py <input.pdf> <output.docx>", file=sys.stderr)
        return 2

    input_path, output_path = sys.argv[1], sys.argv[2]

    try:
        from pdf2docx import Converter

        cv = Converter(input_path)
        try:
            cv.convert(output_path)
        finally:
            cv.close()
    except Exception as exc:  # noqa: BLE001 - surface any failure to the caller
        print(f"pdf2docx conversion failed: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
