#!/usr/bin/env node
// One-off asset-store audit: walk /app/data/assets (or $PROJECT_ASSETS_DIR),
// validate each file's magic bytes against its extension, and report corrupt
// files. Pass --quarantine to move corrupt files into a .quarantine dir instead
// of deleting them (destructive step needs explicit approval).
//
// Usage:
//   node scripts/audit-project-assets.mjs             # report only
//   node scripts/audit-project-assets.mjs --quarantine # report + move corrupt files

import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";

const ASSETS_ROOT = process.env.PROJECT_ASSETS_DIR || "/app/data/assets";
const QUARANTINE_DIR = join(ASSETS_ROOT, ".quarantine");

// Returns true when the bytes match the extension's signature, false when they
// are corrupt, and null when the extension has no known signature (unchecked).
function magicOk(relPath, bytes) {
  const ext = relPath.split(".").pop().toLowerCase();
  if (ext === "png") {
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (ext === "jpg" || ext === "jpeg") {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (ext === "gif") {
    return bytes.length > 6 && bytes.subarray(0, 3).toString() === "GIF";
  }
  if (ext === "pdf") {
    return bytes.length > 5 && bytes.subarray(0, 5).toString() === "%PDF-";
  }
  if (ext === "bmp") {
    return bytes.length > 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
  }
  if (ext === "webp") {
    return bytes.length > 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  }
  if (ext === "ico") {
    return bytes.length > 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00;
  }
  return null;
}

async function walk(dir, prefix = "") {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === ".quarantine") continue;
      result.push(...(await walk(full, rel)));
    } else if (entry.isFile()) {
      result.push({ rel, full });
    }
  }
  return result;
}

const quarantine = process.argv.includes("--quarantine");
const files = await walk(ASSETS_ROOT);
const corrupt = [];
const unchecked = [];

for (const file of files) {
  const bytes = await readFile(file.full);
  const ok = magicOk(file.rel, bytes);
  if (ok === null) {
    unchecked.push(file.rel);
  } else if (!ok) {
    corrupt.push(file);
  }
}

console.log(`Scanned ${files.length} files under ${ASSETS_ROOT}`);
console.log(`Corrupt: ${corrupt.length}; unchecked (non-asset extension): ${unchecked.length}`);

for (const file of corrupt) {
  console.log(`  CORRUPT ${file.rel} -> ${file.full}`);
}

if (quarantine) {
  if (!corrupt.length) {
    console.log("Nothing to quarantine.");
  } else {
    await mkdir(QUARANTINE_DIR, { recursive: true });
    for (const file of corrupt) {
      const dest = join(QUARANTINE_DIR, file.rel.replace(/\//g, "__"));
      await rename(file.full, dest);
      console.log(`  QUARANTINED ${file.rel} -> ${dest}`);
    }
    console.log(`Moved ${corrupt.length} corrupt file(s) into ${QUARANTINE_DIR}`);
  }
}
