#!/usr/bin/env python3
"""Build an .xlsx marks workbook from an assessment JSON payload.

Usage: python3 assess-export.py <input.json> <output.xlsx>
"""
import json
import sys

from openpyxl import Workbook


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: assess-export.py <input.json> <output.xlsx>", file=sys.stderr)
        sys.exit(2)

    with open(sys.argv[1], encoding="utf-8") as fh:
        data = json.load(fh)

    wb = Workbook()
    ws = wb.active
    ws.title = "Marks"

    header = ["Student ID", "Name", "Surname", "Programme"]
    practicals = data.get("practicals", [])
    tests = data.get("tests", [])
    exams = data.get("exams", [])
    for item in practicals + tests + exams:
        header.append(item.get("title", "Item"))
    ws.append(header)

    mark_map = {
        (m.get("itemId"), m.get("studentId")): m.get("score")
        for m in data.get("marks", [])
    }

    for student in data.get("students", []):
        row = [
            student.get("studentId", ""),
            student.get("name", ""),
            student.get("surname", ""),
            student.get("programme", ""),
        ]
        for item in practicals + tests + exams:
            row.append(mark_map.get((item.get("id"), student.get("userId"))))
        ws.append(row)

    wb.save(sys.argv[2])
    print(sys.argv[2])


if __name__ == "__main__":
    main()
