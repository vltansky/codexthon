import { createClientFromRequest } from "npm:@base44/sdk";

import { verifyAccessToken } from "./access-link.ts";
import { recordPortalSeen, recordPromoClaim } from "./portal-activity.ts";
import { loadPortalResponse } from "./portal-response.ts";

const securityHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

Deno.serve(async (request) => {
  try {
    const secret = Deno.env.get("ACCESS_LINK_SECRET");
    if (!secret) return Response.json({ error: "Access unavailable" }, { status: 503, headers: securityHeaders });
    const body = (await request.json()) as { token?: string; action?: string };
    if (!body.token || body.token.length > 2048) {
      return Response.json({ error: "Access link is invalid" }, { status: 401, headers: securityHeaders });
    }
    const payload = await verifyAccessToken(body.token, secret);
    const base44 = createClientFromRequest(request);
    const participants = await base44.asServiceRole.entities.Participant.filter({ access_key: payload.accessKey }, undefined, 2);
    const participant = participants[0];
    if (
      participants.length !== 1 ||
      !participant ||
      participant.active === false ||
      participant.access_enabled === false ||
      participant.access_version !== payload.version
    ) {
      return Response.json({ error: "Access link is invalid" }, { status: 401, headers: securityHeaders });
    }
    if (body.action === "promo-claimed") {
      return Response.json(await recordPromoClaim(base44, participant), { headers: securityHeaders });
    }
    await recordPortalSeen(base44, participant);
    return Response.json(await loadPortalResponse(base44, participant), { headers: securityHeaders });
  } catch {
    return Response.json({ error: "Access link is invalid" }, { status: 401, headers: securityHeaders });
  }
});
