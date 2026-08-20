#!/usr/bin/env python3
"""Normalize a tool output for deterministic hashing.

- PDF: strip /CreationDate and /ModDate from the trailer Info, and force a
  deterministic /ID (pikepdf static_id). If PDF_PASSWORD is set, decrypt first.
- ZIP (and PPTX/XLSX, which are zips): rewrite with a fixed entry mtime, and
  normalise OOXML dcterms:created/modified timestamps in docProps/core.xml.
- Text: pass through unchanged.

Prints one line: "<sha256> <size-bytes> <page-count-or-zip-entries>"
"""
import hashlib
import io
import os
import re
import sys
import zipfile

FIXED_MTIME = (1980, 1, 1, 0, 0, 0)


def normalize_pdf(data: bytes, password: str = "") -> bytes:
    import pikepdf

    pdf = pikepdf.open(io.BytesIO(data), password=password)
    info = pdf.trailer.get("/Info")
    if isinstance(info, pikepdf.Dictionary):
        for key in ("/CreationDate", "/ModDate"):
            if key in info:
                del info[key]
    out = io.BytesIO()
    # static_id=True gives a content-derived, reproducible document ID.
    pdf.save(out, static_id=True)
    return out.getvalue()


def normalize_zip(data: bytes) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as zin:
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                content = zin.read(item.filename)
                # OOXML (PPTX/XLSX) embeds dcterms:created/modified timestamps
                # in docProps/core.xml — normalise them to a constant.
                if item.filename == "docProps/core.xml":
                    content = re.sub(
                        rb"(<dcterms:(?:created|modified)[^>]*>)[^<]*(</dcterms:(?:created|modified)>)",
                        lambda m: m.group(1) + b"1980-01-01T00:00:00Z" + m.group(2),
                        content,
                    )
                item.date_time = FIXED_MTIME
                zout.writestr(item, content)
    return out.getvalue()


def pdf_page_count(data: bytes, password: str = "") -> int:
    import pikepdf

    return len(pikepdf.open(io.BytesIO(data), password=password).pages)


def zip_entry_count(data: bytes) -> int:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return len(z.namelist())


def detect_type(data: bytes) -> str:
    if data.startswith(b"%PDF"):
        return "pdf"
    if data.startswith(b"PK"):
        return "zip"
    return "text"


def main(path: str, password: str = "") -> None:
    data = open(path, "rb").read()
    kind = detect_type(data)
    try:
        if kind == "pdf":
            norm = normalize_pdf(data, password)
            pages = pdf_page_count(data, password)
        elif kind == "zip":
            norm = normalize_zip(data)
            pages = zip_entry_count(data)
        else:
            norm = data
            pages = 0
    except Exception as exc:  # noqa: BLE001 - surface non-normalizable outputs
        print(f"NONNORMALIZABLE:{type(exc).__name__} {len(data)} 0")
        return
    digest = hashlib.sha256(norm).hexdigest()
    print(f"{digest} {len(data)} {pages}")


if __name__ == "__main__":
    main(sys.argv[1], os.environ.get("PDF_PASSWORD", ""))
