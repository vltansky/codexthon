import { verifyAccessToken } from "./access-link.ts";

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

export async function participantFromAccessToken(client: any, token: string, secret: string) {
  if (token.length > 2048) throw new Error("Access link is invalid");
  const payload = await verifyAccessToken(token, secret);
  const participants = await client.entities.Participant.filter({ access_key: payload.accessKey }, undefined, 2);
  const participant = participants[0];
  if (
    participants.length !== 1 ||
    !participant ||
    participant.active === false ||
    participant.access_enabled === false ||
    participant.access_version !== payload.version
  ) {
    throw new Error("Access link is invalid");
  }
  return participant;
}
