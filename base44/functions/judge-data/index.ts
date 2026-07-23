import { createClientFromRequest } from "npm:@base44/sdk";
import { verifyAccessToken } from "./access-link.ts";
import { matchJudgeByEmail, summarizeJudgeGroups } from "./judge-groups.ts";

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

    // Admin-entered judge emails may carry mixed casing, so the match happens in code.
    const judges = await base44.asServiceRole.entities.Judge.list("display_name", 1000);
    const judge = matchJudgeByEmail(judges, user.email);
    if (!judge) {
      return Response.json({ error: "Your email is not on the judge list" }, { status: 404 });
    }

    return judgeResponse(base44, judge);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load judge portal" },
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
  let judge;
  try {
    const payload = await verifyAccessToken(token, secret);
    const judges = await base44.asServiceRole.entities.Judge.filter({ access_key: payload.accessKey }, undefined, 2);
    judge = judges[0];
    if (judges.length !== 1 || !judge || (judge.access_version || 1) !== payload.version) throw new Error();
  } catch {
    return Response.json({ error: "Access link is invalid" }, { status: 401, headers: securityHeaders });
  }
  if (body.action === "set-email") return setEmailResponse(base44, judge, body.email);
  return judgeResponse(base44, judge);
}

async function setEmailResponse(base44: any, judge: any, emailInput: unknown) {
  const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address" }, { status: 400, headers: securityHeaders });
  }
  // The email doubles as the judge's login credential, so a link holder may only fill it in, never replace it.
  if (judge.email) {
    return Response.json({ error: "An email is already on record for you" }, { status: 409, headers: securityHeaders });
  }
  const judges = await base44.asServiceRole.entities.Judge.list("display_name", 1000);
  if (matchJudgeByEmail(judges.filter((other: any) => other.id !== judge.id), email)) {
    return Response.json({ error: "This email already belongs to another judge" }, { status: 409, headers: securityHeaders });
  }
  await base44.asServiceRole.entities.Judge.update(judge.id, { email });
  return judgeResponse(base44, { ...judge, email });
}

async function judgeResponse(base44: any, judge: any) {
  const [groups, participants, mentors, judges] = await Promise.all([
    base44.asServiceRole.entities.JudgeGroup.list("name", 5000),
    base44.asServiceRole.entities.Participant.list("display_name", 5000),
    base44.asServiceRole.entities.Mentor.list("display_name", 1000),
    base44.asServiceRole.entities.Judge.list("display_name", 1000),
  ]);
  const mentorNamesByKey = new Map<string, string>(mentors.map((mentor: any) => [mentor.mentor_key, mentor.display_name]));
  const judgeNamesByKey = new Map<string, string>(judges.map((other: any) => [other.judge_key, other.display_name]));
  return Response.json({
    judge: { displayName: judge.display_name, email: judge.email || null },
    groups: summarizeJudgeGroups(groups, judge.judge_key, participants, mentorNamesByKey, judgeNamesByKey),
  }, { headers: securityHeaders });
}
