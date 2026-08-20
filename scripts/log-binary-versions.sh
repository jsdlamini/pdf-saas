#!/bin/sh
# Startup log of pinned server binary versions. Run on every container start so a
# version drift is visible in `docker logs` rather than silently changing OCR /
# compression / conversion output. Logs; does not fail startup on drift.

echo "=== WiserFiles pinned binary versions ==="

ocrmypdf_v="$(ocrmypdf --version 2>/dev/null | head -n 1)"
echo "ocrmypdf:    ${ocrmypdf_v:-MISSING}"

tesseract_v="$(tesseract --version 2>/dev/null | head -n 1)"
echo "tesseract:   ${tesseract_v:-MISSING}"

gs_v="$(gs --version 2>/dev/null)"
echo "ghostscript: ${gs_v:-MISSING}"

lo_v="$(libreoffice --version 2>/dev/null | head -n 1)"
echo "libreoffice: ${lo_v:-MISSING}"

pdf2docx_v="$(python3 -c 'import importlib.metadata as m; print(m.version("pdf2docx"))' 2>/dev/null)"
echo "pdf2docx:    ${pdf2docx_v:-MISSING}"

pymupdf_v="$(python3 -c 'import importlib.metadata as m; print(m.version("pymupdf"))' 2>/dev/null)"
echo "pymupdf:     ${pymupdf_v:-MISSING}"

python_docx_v="$(python3 -c 'import importlib.metadata as m; print(m.version("python-docx"))' 2>/dev/null)"
echo "python-docx: ${python_docx_v:-MISSING}"

echo "=== pinned (apt): ocrmypdf=14.0.1+dfsg1-1 tesseract-ocr=5.3.0-2 ghostscript=10.0.0~dfsg-11+deb12u8 libreoffice-writer=4:7.4.7-1+deb12u14 ==="
echo "=== pinned (pip): pdf2docx==0.5.13 pymupdf==1.28.2 python-docx==1.2.0 ==="
