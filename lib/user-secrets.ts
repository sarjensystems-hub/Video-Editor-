import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for secrets a user hands us — today, their own
 * OpenRouter API key.
 *
 * These are not passwords: the server has to be able to *use* the value, so
 * hashing (what the OAuth tokens do) is not an option. AES-256-GCM with a
 * per-value random IV is, and its authentication tag means a tampered
 * ciphertext fails to decrypt rather than silently producing garbage that we
 * would then send to OpenRouter as a bearer token.
 *
 * The encryption key lives in the environment, never in Postgres, so a
 * database dump on its own decrypts nothing.
 */

const VERSION = "v1";

/**
 * 32 bytes, as 64 hex characters or base64.
 *
 * `OAUTH_TOKEN_KEY` is accepted as a fallback because it is already documented
 * and set on existing deployments, and is exactly the same shape. Prefer the
 * dedicated name on anything new.
 */
function encryptionKey(): Buffer {
  const raw = process.env.API_KEY_ENCRYPTION_KEY ?? process.env.OAUTH_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      "API_KEY_ENCRYPTION_KEY is not configured. Generate one with " +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"`.",
    );
  }

  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (key.length !== 32) {
    throw new Error("API_KEY_ENCRYPTION_KEY must be 32 bytes (64 hex characters, or base64).");
  }
  return key;
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, each part base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

/**
 * Reverses `encryptSecret`. Throws on a value this function did not produce, on
 * a tampered one, and on a key that no longer matches — all of which mean the
 * stored secret is unusable and the user has to paste it again.
 */
export function decryptSecret(encoded: string): string {
  const parts = encoded.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Stored secret is not in the expected format.");
  }

  const [, ivPart, tagPart, ciphertextPart] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** The last four characters, for showing which key is stored without revealing it. */
export function secretLast4(plaintext: string): string {
  return plaintext.trim().slice(-4);
}

/**
 * An OpenRouter key is `sk-or-v1-…`. Checking the shape here turns a paste
 * error into an immediate, specific message instead of a 401 on the user's
 * first render, half an hour later.
 */
export function isLikelyOpenRouterKey(value: string): boolean {
  const trimmed = value.trim();
  return /^sk-or-[A-Za-z0-9._-]{16,}$/.test(trimmed);
}
