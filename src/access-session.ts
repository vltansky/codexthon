export function accessTokenFromHash(hash: string): string | null {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  const token = parameters.get("access")?.trim();
  return token || null;
}

export function buildAccessHash(token: string): string {
  return `#access=${encodeURIComponent(token)}`;
}
