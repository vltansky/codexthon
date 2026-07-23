import { createClientFromRequest } from "npm:@base44/sdk";

import { bearerToken, participantFromAccessToken } from "./participant.ts";
import { handlePortalMcpProtocolRequest } from "./server.ts";

const privateHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

Deno.serve(async (request) => {
  const secret = Deno.env.get("ACCESS_LINK_SECRET");
  if (!secret) return Response.json({ error: "Event MCP is not configured" }, { status: 503, headers: privateHeaders });

  const token = bearerToken(request);
  if (!token) return unauthorized("Send your personal event key as an Authorization: Bearer header");

  const base44 = createClientFromRequest(request);
  let participant;
  try {
    participant = await participantFromAccessToken(base44.asServiceRole, token, secret);
  } catch {
    return unauthorized("Your personal event key is invalid or expired");
  }

  const response = await handlePortalMcpProtocolRequest(base44.asServiceRole, participant, request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});

function unauthorized(message: string) {
  return Response.json({ error: message }, {
    status: 401,
    headers: { ...privateHeaders, "WWW-Authenticate": "Bearer" },
  });
}
