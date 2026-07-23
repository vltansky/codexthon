import { createClientFromRequest } from "npm:@base44/sdk";
import { verifyAccessToken } from "./access-link.ts";
import { matchMentorByEmail, summarizeMentorTeams } from "./mentor-teams.ts";

const securityHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

Deno.serve(async (request) => {
  try {
    const base44 = createClientFromRequest(request);
    const body = await request.json().catch(() => ({})) as { token?: string; action?: string; email?: string };
    if (body.token) return tokenResponse(base44, body);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    // Admin-entered mentor emails may carry mixed casing, so the match happens in code.
    const mentors = await base44.asServiceRole.entities.Mentor.list("display_name", 1000);
    const mentor = matchMentorByEmail(mentors, user.email);
    if (!mentor) {
      return Response.json({ error: "Your email is not on the mentor list" }, { status: 404 });
    }

    return mentorResponse(base44, mentor);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load mentor portal" },
      { status: 500 },
    );
  }
});

async function tokenResponse(base44: any, body: { token?: string; action?: string; email?: string }) {
  const token = body.token ?? "";
  const secret = Deno.env.get("ACCESS_LINK_SECRET");
  if (!secret || token.length > 2048) {
    return Response.json({ error: "Access link is invalid" }, { status: 401, headers: securityHeaders });
  }
  let mentor;
  try {
    const payload = await verifyAccessToken(token, secret);
    const mentors = await base44.asServiceRole.entities.Mentor.filter({ access_key: payload.accessKey }, undefined, 2);
    mentor = mentors[0];
    if (mentors.length !== 1 || !mentor || (mentor.access_version || 1) !== payload.version) throw new Error();
  } catch {
    return Response.json({ error: "Access link is invalid" }, { status: 401, headers: securityHeaders });
  }
  if (body.action === "set-email") return setEmailResponse(base44, mentor, body.email);
  return mentorResponse(base44, mentor);
}

async function setEmailResponse(base44: any, mentor: any, emailInput: unknown) {
  const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address" }, { status: 400, headers: securityHeaders });
  }
  // The email doubles as the mentor's login credential, so a link holder may only fill it in, never replace it.
  if (mentor.email) {
    return Response.json({ error: "An email is already on record for you" }, { status: 409, headers: securityHeaders });
  }
  const mentors = await base44.asServiceRole.entities.Mentor.list("display_name", 1000);
  if (matchMentorByEmail(mentors.filter((other: any) => other.id !== mentor.id), email)) {
    return Response.json({ error: "This email already belongs to another mentor" }, { status: 409, headers: securityHeaders });
  }
  await base44.asServiceRole.entities.Mentor.update(mentor.id, { email });
  return mentorResponse(base44, { ...mentor, email });
}

async function mentorResponse(base44: any, mentor: any) {
  const participants = await base44.asServiceRole.entities.Participant.filter({ mentor_key: mentor.mentor_key }, "display_name", 5000);
  return Response.json({
    mentor: { displayName: mentor.display_name, email: mentor.email || null },
    teams: summarizeMentorTeams(participants),
  }, { headers: securityHeaders });
}
