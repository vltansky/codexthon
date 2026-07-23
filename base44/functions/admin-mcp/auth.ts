export async function hasValidBearerToken(request: Request, secret: string): Promise<boolean> {
  const authorization = request.headers.get("Authorization") ?? "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const [candidateDigest, secretDigest] = await Promise.all([digest(candidate), digest(secret)]);
  let difference = candidate.length === secret.length ? 0 : 1;
  for (let index = 0; index < secretDigest.length; index += 1) difference |= candidateDigest[index]! ^ secretDigest[index]!;
  return difference === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
