#!/usr/bin/env python3
"""Server-side PDF redaction via PyMuPDF.

Unlike the old client-side rasterise-then-draw approach (which turned the whole
document into JPEGs and destroyed searchability everywhere), this deletes only
the glyphs and covered image data inside each rectangle via
add_redact_annot() + apply_redactions(), leaving the rest of the document as
real, searchable text.

Usage:
    python3 redact-pdf.py <input.pdf> <rects.json> <output.pdf>

rects.json is a JSON array of {page, x, y, w, h} with page 1-indexed and
coordinates in PDF points.
"""

import json
import sys

import pymupdf


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: redact-pdf.py <input.pdf> <rects.json> <output.pdf>", file=sys.stderr)
        return 2

    input_pdf, rects_json, output_pdf = sys.argv[1], sys.argv[2], sys.argv[3]

    try:
        doc = pymupdf.open(input_pdf)
    except Exception as exc:  # noqa: BLE001
        print(f"could not open PDF: {exc}", file=sys.stderr)
        return 1

    try:
        with open(rects_json, "r", encoding="utf-8") as fh:
            rects = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        print(f"could not read rects: {exc}", file=sys.stderr)
        return 1

    for item in rects:
        try:
            page_index = int(item.get("page", 1)) - 1
            if page_index < 0 or page_index >= doc.page_count:
                continue
            page = doc[page_index]
            rect = pymupdf.Rect(
                float(item["x"]),
                float(item["y"]),
                float(item["x"]) + float(item["w"]),
                float(item["y"]) + float(item["h"]),
            )
            if rect.is_empty:
                continue
            page.add_redact_annot(rect, fill=(0, 0, 0))
        except (KeyError, TypeError, ValueError):
            continue

    for page in doc:
        page.apply_redactions()

    doc.save(output_pdf, garbage=3, deflate=True)
    doc.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
