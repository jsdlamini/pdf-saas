#!/usr/bin/env python3
"""Compare run1 vs run2 and emit the baseline table.
Deterministic tools: normalize+hash, compare. Raster tools: SSIM.
protect-pdf is decrypted before hashing/SSIM."""
import io
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image

base = os.path.abspath(sys.argv[1])
RASTER = {"compress-pdf", "redact-pdf", "protect-pdf"}
PASSWORDS = {"protect-pdf": "secret123"}


def normalize(path, password=""):
    env = dict(os.environ, PDF_PASSWORD=password)
    return subprocess.check_output(
        ["python3", os.path.join(base, "normalize.py"), path], env=env
    ).decode().strip().split()


def decrypt(path, password):
    import pikepdf

    pdf = pikepdf.open(path, password=password)
    fd, tmp = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    pdf.save(tmp)
    return tmp


def render_page(pdf_path, page, dpi=96):
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


def ssim_pdfs(a, b, password=""):
    import pikepdf

    if password:
        a = decrypt(a, password)
        b = decrypt(b, password)
    n = min(len(pikepdf.open(a).pages), len(pikepdf.open(b).pages))
    vals = [ssim(render_page(a, p), render_page(b, p)) for p in range(1, n + 1)]
    return sum(vals) / len(vals) if vals else 1.0


rows = []
mismatches = []
for slug in sorted(os.listdir(os.path.join(base, "run1"))):
    d1 = os.path.join(base, "run1", slug)
    d2 = os.path.join(base, "run2", slug)
    if not os.path.isdir(d1):
        continue
    for f in sorted(os.listdir(d1)):
        if not f.endswith(".out"):
            continue
        p1 = os.path.join(d1, f)
        p2 = os.path.join(d2, f)
        pw = PASSWORDS.get(slug, "")
        if slug in RASTER:
            s = ssim_pdfs(p1, p2, pw)
            rows.append({"tool": slug, "case": f[:-4], "metric": "ssim", "value": round(s, 6)})
        else:
            o1 = normalize(p1, pw)
            if o1[0].startswith("NONNORMALIZABLE"):
                rows.append({"tool": slug, "case": f[:-4], "metric": o1[0].split(":", 1)[0], "value": o1[0].split(":", 1)[1]})
            else:
                o2 = normalize(p2, pw)
                rows.append({"tool": slug, "case": f[:-4], "metric": "hash", "hash": o1[0], "size": int(o1[1]), "pages": int(o1[2])})
                if o1[0] != o2[0]:
                    mismatches.append(f"{slug}/{f[:-4]}")

print(f"cases: {len(rows)}  mismatches: {len(mismatches)}")
for r in rows:
    if r["metric"] == "hash":
        print(f"{r['tool']:<20} {r['case']:<12} {r['size']:>8} {r['pages']:>4}  {r['hash']}")
    else:
        print(f"{r['tool']:<20} {r['case']:<12} [{r['metric']}] {r['value']}")
if mismatches:
    print("\nMISMATCHES:", *mismatches, sep="\n  ")
json.dump({"results": rows, "mismatches": mismatches}, open(os.path.join(base, "baseline-hashes.json"), "w"), indent=2)
print("\nwrote baseline-hashes.json")
