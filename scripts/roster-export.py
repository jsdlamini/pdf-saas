#!/usr/bin/env python3
"""Build an .xlsx group roster (with marks) from a roster JSON payload.

Usage: python3 roster-export.py <input.json> <output.xlsx>
"""
import json
import sys

from openpyxl import Workbook
from openpyxl.styles import Font


def fmt(mark) -> str:
    if not mark:
        return "—"
    score = mark.get("score")
    if score is None:
        return "—"
    return f"{score} / {mark.get('max', 0)}"


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: roster-export.py <input.json> <output.xlsx>", file=sys.stderr)
        sys.exit(2)

    with open(sys.argv[1], encoding="utf-8") as fh:
        rows = json.load(fh)

    wb = Workbook()
    ws = wb.active
    ws.title = "Roster"

    header = ["Group", "Student ID", "Name", "Surname", "Programme", "Practical", "Test", "Exam"]
    ws.append(header)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for r in rows:
        ws.append([
            r.get("group", ""),
            r.get("studentId", ""),
            r.get("name", ""),
            r.get("surname", ""),
            r.get("programme", ""),
            fmt(r.get("practical")),
            fmt(r.get("test")),
            fmt(r.get("exam")),
        ])

    # Reasonable column widths.
    widths = [22, 14, 16, 16, 22, 12, 12, 12]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + i)].width = w

    wb.save(sys.argv[2])
    print(sys.argv[2])


if __name__ == "__main__":
    main()
