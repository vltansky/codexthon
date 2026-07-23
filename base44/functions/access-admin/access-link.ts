export interface AccessTokenPayload {
  accessKey: string;
  version: number;
  expiresAt: string;
}

export async function signAccessToken(payload: AccessTokenPayload, secret: string): Promise<string> {
  validatePayload(payload);
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = await sign(`v1.${encodedPayload}`, secret);
  return `v1.${encodedPayload}.${signature}`;
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
  if (!payload || typeof payload.accessKey !== "string" || payload.accessKey.length < 16) throw new Error("Access link is invalid");
  if (!Number.isInteger(payload.version) || payload.version < 1) throw new Error("Access link is invalid");
  if (!Number.isFinite(Date.parse(payload.expiresAt))) throw new Error("Access link is invalid");
}

function encodeBase64Url(value: string): string {
  return encodeBase64UrlBytes(new TextEncoder().encode(value));
}

function encodeBase64UrlBytes(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
