export interface AccessTokenPayload {
  accessKey: string;
  version: number;
  expiresAt: string;
}

export async function verifyAccessToken(token: string, secret: string, now = new Date()): Promise<AccessTokenPayload> {
  try {
    const [version, encodedPayload, suppliedSignature, extra] = token.split(".");
    if (version !== "v1" || !encodedPayload || !suppliedSignature || extra) throw new Error();
    const expectedSignature = await sign(`${version}.${encodedPayload}`, secret);
    if (!constantTimeEqual(suppliedSignature, expectedSignature)) throw new Error();
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as AccessTokenPayload;
    validatePayload(payload);
    if (Date.parse(payload.expiresAt) <= now.getTime()) throw new Error();
    return payload;
  } catch {
    throw new Error("Access link is invalid");
  }
}

async function sign(value: string, secret: string): Promise<string> {
  if (secret.length < 32) throw new Error("Access link is invalid");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return encodeBase64UrlBytes(new Uint8Array(signature));
}

function validatePayload(payload: AccessTokenPayload): void {
  if (!payload || typeof payload.accessKey !== "string" || payload.accessKey.length < 16) throw new Error();
  if (!Number.isInteger(payload.version) || payload.version < 1) throw new Error();
  if (!Number.isFinite(Date.parse(payload.expiresAt))) throw new Error();
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function encodeBase64UrlBytes(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}
