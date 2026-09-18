#!/usr/bin/env python3
"""Build an .xlsx group roster (raw per-item marks) from a roster JSON payload.

Usage: python3 roster-export.py <input.json> <output.xlsx>
"""
import json
import sys

from openpyxl import Workbook
from openpyxl.styles import Font


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: roster-export.py <input.json> <output.xlsx>", file=sys.stderr)
        sys.exit(2)

    with open(sys.argv[1], encoding="utf-8") as fh:
        data = json.load(fh)

    columns = data.get("columns", [])
    rows = data.get("rows", [])

    wb = Workbook()
    ws = wb.active
    ws.title = "Roster"

    header = ["Group", "Student ID", "Name", "Surname", "Programme"]
    for col in columns:
        header.append(col.get("title", "Item"))
    ws.append(header)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for r in rows:
        row = [
            r.get("group", ""),
            r.get("studentId", ""),
            r.get("name", ""),
            r.get("surname", ""),
            r.get("programme", ""),
        ]
        scores = r.get("scores", [])
        for i, _ in enumerate(columns):
            score = scores[i] if i < len(scores) else None
            row.append("—" if score is None else score)
        ws.append(row)

    widths = [22, 14, 16, 16, 22] + [12] * max(len(columns), 1)
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + i)].width = w

    wb.save(sys.argv[2])
    print(sys.argv[2])


if __name__ == "__main__":
    main()
