#!/usr/bin/env python3
"""Perceptual (SSIM) comparison of two PDFs, page by page, rendered via Ghostscript.
Used for the raster-nondeterministic tools (compress, redact, protect) where byte
hashes can't be stable but the *content* must be perceptually identical.
Prints one "page <n>: <ssim>" line per page, then "MEAN <ssim>"."""
import io
import subprocess
import sys

from PIL import Image


def render_pages(pdf_path, dpi=96):
    out = subprocess.check_output(
        ["gs", "-sDEVICE=pnggray", f"-r{dpi}", "-o", "-", pdf_path],
        stderr=subprocess.DEVNULL,
    )
    # gs -o - with multiple pages emits a single multi-frame? No: it emits one
    # image per page to stdout concatenated is not supported; render page-by-page.
    # Fall back to per-page rendering below.
    return out


def render_page(pdf_path, page, dpi=96):
    import tempfile, os
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    subprocess.check_output(
        ["gs", "-sDEVICE=pnggray", f"-r{dpi}", f"-dFirstPage={page}", f"-dLastPage={page}", "-o", tmp, pdf_path],
        stderr=subprocess.DEVNULL,
    )
    img = Image.open(tmp).convert("L")
    os.unlink(tmp)
    return img


def ssim(img_a, img_b):
    a = img_a.resize((min(img_a.width, img_b.width), min(img_a.height, img_b.height)))
    b = img_b.resize((min(img_a.width, img_b.width), min(img_a.height, img_b.height)))
    pa = list(a.getdata())
    pb = list(b.getdata())
    n = len(pa)
    mu_a = sum(pa) / n
    mu_b = sum(pb) / n
    var_a = sum((x - mu_a) ** 2 for x in pa) / (n - 1)
    var_b = sum((x - mu_b) ** 2 for x in pb) / (n - 1)
    cov = sum((pa[i] - mu_a) * (pb[i] - mu_b) for i in range(n)) / (n - 1)
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    return ((2 * mu_a * mu_b + c1) * (2 * cov + c2)) / (
        (mu_a**2 + mu_b**2 + c1) * (var_a + var_b + c2)
    )


def page_count(pdf_path):
    import pikepdf

    return len(pikepdf.open(pdf_path).pages)


def main():
    a, b = sys.argv[1], sys.argv[2]
    pa = page_count(a)
    pb = page_count(b)
    n = min(pa, pb)
    vals = []
    for p in range(1, n + 1):
        ia = render_page(a, p)
        ib = render_page(b, p)
        v = ssim(ia, ib)
        vals.append(v)
        print(f"page {p}: {v:.6f}")
    if vals:
        print(f"MEAN {sum(vals) / len(vals):.6f}")


if __name__ == "__main__":
    main()
