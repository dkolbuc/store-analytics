/**
 * Sesja oparta na podpisanym ciasteczku: base64url(payload).base64url(HMAC-SHA256).
 * Tylko Web Crypto (crypto.subtle) — bez Node crypto, bez zależności.
 */

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Tworzy wartość ciasteczka sesji ważnego 7 dni. */
export async function createSession(env: Env): Promise<string> {
  const payload = b64uEncode(
    new TextEncoder().encode(JSON.stringify({ exp: Date.now() + 7 * 86_400_000 }))
  );
  const key = await importKey(env.SESSION_SECRET);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${b64uEncode(sig)}`;
}

/**
 * Weryfikuje ciasteczko sesji.
 * Porównanie podpisu jest stałoczasowe (crypto.subtle.verify).
 */
export async function verifySession(
  cookieValue: string | undefined,
  env: Env
): Promise<boolean> {
  if (!cookieValue) return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return false;

  const payloadPart = cookieValue.slice(0, dot);
  const sigPart = cookieValue.slice(dot + 1);

  try {
    const key = await importKey(env.SESSION_SECRET);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64uDecode(sigPart),
      new TextEncoder().encode(payloadPart)
    );
    if (!valid) return false;

    const decoded = JSON.parse(new TextDecoder().decode(b64uDecode(payloadPart)));
    return typeof decoded.exp === "number" && decoded.exp > Date.now();
  } catch {
    return false;
  }
}
