import { createClientFromRequest } from "npm:@base44/sdk";
import { signAccessToken } from "./access-link.ts";
import { recordPortalSeen, recordPromoClaim } from "./portal-activity.ts";
import { loadPortalResponse } from "./portal-response.ts";

Deno.serve(async (request) => {
  try {
    const base44 = createClientFromRequest(request);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as { action?: string };
    const email = user.email.trim().toLowerCase();
    const participants = await base44.asServiceRole.entities.Participant.filter({ email }, undefined, 1);
    const participant = participants[0];
    if (!participant) {
      return Response.json({ error: "Your email is not on the participant list" }, { status: 404 });
    }

    if (participant.active === false) {
      return Response.json({ error: "Your registration is not active" }, { status: 403 });
    }
    if (body.action === "promo-claimed") {
      return Response.json(await recordPromoClaim(base44, participant), {
        headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
    }
    await recordPortalSeen(base44, participant);
    const portal = await loadPortalResponse(base44, participant);
    return Response.json({ ...portal, mcpToken: await eventMcpToken(participant) }, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load participant portal" },
      { status: 500 },
    );
  }
});

// Signed-in participants never see a link token, so the portal mints the same
// credential here for the "connect your agent" card.
async function eventMcpToken(participant: any): Promise<string | null> {
  const secret = Deno.env.get("ACCESS_LINK_SECRET");
  if (!secret || !participant.access_key || participant.access_enabled === false) return null;
  try {
    return await signAccessToken({
      accessKey: participant.access_key,
      version: participant.access_version ?? 1,
      expiresAt: participant.access_expires_at,
    }, secret);
  } catch {
    return null;
  }
}
