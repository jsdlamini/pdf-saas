// Encrypt integration secrets at rest (AES-256-GCM).
//
// The key lives OUTSIDE the database: ENCRYPTION_KEY in the server env. If it
// is unset, a clearly-labelled non-secret fallback keeps the app running in dev
// — production MUST set ENCRYPTION_KEY. Legacy plaintext values (stored before
// encryption) are passed through unchanged on read so existing PATs keep working.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const FALLBACK = "wiserfiles-dev-encryption-key-not-secret";

function deriveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  const material = raw && raw.length >= 32 ? raw : FALLBACK;
  return createHash("sha256").update(material).digest();
}

const KEY = deriveKey();

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith("enc:v1:")) return stored; // legacy plaintext
  try {
    const parts = stored.split(":");
    const iv = Buffer.from(parts[2], "base64");
    const tag = Buffer.from(parts[3], "base64");
    const data = Buffer.from(parts[4], "base64");
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return stored; // undecryptable → return as-is so the caller reports a bad token
  }
}
