import { createClientFromRequest } from "npm:@base44/sdk";

import { appUrl } from "./app-url.ts";
import { buildMentorInviteEmail } from "./branded-email.ts";
import { sendGmailAccessEmail } from "./gmail.ts";

const batchSize = 50;

Deno.serve(async (request) => {
  try {
    const base44 = createClientFromRequest(request);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") return Response.json({ error: "Admin access required" }, { status: 403 });

    const body = await request.json() as Record<string, unknown>;
    const mentorIds = Array.isArray(body.mentorIds)
      ? body.mentorIds.filter((id): id is string => typeof id === "string").slice(0, batchSize)
      : [];
    if (!mentorIds.length) return Response.json({ error: "Select at least one mentor" }, { status: 400 });

    const results = [];
    for (const mentorId of mentorIds) results.push(await invite(base44, mentorId));
    return Response.json(
      { results },
      { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not send mentor invites" },
      { status: 500 },
    );
  }
});

async function invite(base44: any, mentorId: string) {
  const mentor = await base44.asServiceRole.entities.Mentor.get(mentorId).catch(() => null);
  if (!mentor) return { mentorId, status: "failed", error: "Mentor not found" };
  const email = (mentor.email || "").trim().toLowerCase();
  if (!email) return { mentorId, status: "skipped", error: "Mentor has no email on record" };
  const baseUrl = appUrl();

  const inviteEmail = buildMentorInviteEmail({
    displayName: mentor.display_name,
    email,
    portalUrl: baseUrl,
    imageUrl: `${baseUrl}/codex-email-hero.jpg`,
  });
  try {
    await sendGmailAccessEmail({
      connectors: base44.asServiceRole.connectors,
      fetcher: fetch,
      to: email,
      subject: inviteEmail.subject,
      html: inviteEmail.html,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Gmail is unavailable";
    console.error("Mentor invite delivery failed", { mentorId, detail });
    return { mentorId, status: "failed", error: `${detail}. Connect Gmail in Base44 Dashboard → Integrations.` };
  }
  await base44.asServiceRole.entities.Mentor.update(mentorId, { invited_at: new Date().toISOString() });
  return { mentorId, status: "sent" };
}
