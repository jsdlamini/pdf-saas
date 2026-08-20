#!/usr/bin/env python3
"""Normalize a tool output for deterministic hashing.

- PDF: strip /CreationDate and /ModDate from the trailer Info, and force a
  deterministic /ID (pikepdf static_id).
- ZIP (and PPTX/XLSX, which are zips): rewrite with a fixed entry mtime.
- Text: pass through unchanged.

Prints one line: "<sha256> <size-bytes> <page-count-or-zip-entries>"
"""
import hashlib
import io
import sys
import zipfile

FIXED_MTIME = (1980, 1, 1, 0, 0, 0)


def normalize_pdf(data: bytes) -> bytes:
    import pikepdf

    pdf = pikepdf.open(io.BytesIO(data))
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
                item.date_time = FIXED_MTIME
                zout.writestr(item, zin.read(item.filename))
    return out.getvalue()


def pdf_page_count(data: bytes) -> int:
    import pikepdf

    return len(pikepdf.open(io.BytesIO(data)).pages)


def zip_entry_count(data: bytes) -> int:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return len(z.namelist())


def detect_type(data: bytes) -> str:
    if data.startswith(b"%PDF"):
        return "pdf"
    if data.startswith(b"PK"):
        return "zip"
    return "text"


def main(path: str) -> None:
    data = open(path, "rb").read()
    kind = detect_type(data)
    try:
        if kind == "pdf":
            norm = normalize_pdf(data)
            pages = pdf_page_count(data)
        elif kind == "zip":
            norm = normalize_zip(data)
            pages = zip_entry_count(data)
        else:
            norm = data
            pages = 0
    except Exception as exc:  # noqa: BLE001 - surface non-normalizable outputs
        # Encrypted PDFs, etc. emit a marker so the runner can flag them as
        # non-deterministic rather than producing a misleading hash.
        print(f"NONNORMALIZABLE:{type(exc).__name__} {len(data)} 0")
        return
    digest = hashlib.sha256(norm).hexdigest()
    print(f"{digest} {len(data)} {pages}")


if __name__ == "__main__":
    main(sys.argv[1])
