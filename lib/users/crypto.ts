"use client";

/*
  Password hashing — real client-side crypto, demo-appropriate.
  ================================================================
  Uses the browser's native Web Crypto (SubtleCrypto) to salt + SHA-256 hash
  every password before it's ever written to storage — the plaintext password
  is never persisted or logged anywhere in this app.

  Honest limitation: this still runs entirely in the browser (there is no auth
  backend for this event — see CLAUDE.md), so it protects against "reading the
  stored data shows a plaintext password", not against a determined attacker
  with full access to the browser's JS runtime. A real deployment must hash on
  a server. Swap verifyPassword/hashPassword's callers in lib/users/store.ts to
  a real API and nothing else in the app needs to change.
*/

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

/** Hash a new password. Returns { hash, salt } — store both, never the plaintext. */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomSalt();
  const hash = await sha256Hex(`${salt}:${password}`);
  return { hash, salt };
}

/** Check a login attempt against a stored hash + salt. */
export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const attempt = await sha256Hex(`${salt}:${password}`);
  return attempt === hash;
}
