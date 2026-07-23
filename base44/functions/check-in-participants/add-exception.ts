import { findAvailablePromo } from "./eligibility.ts";
import { resolveExceptionTeam } from "./exception-team.ts";

export async function addException(base44: any, body: Record<string, unknown>) {
  const displayName = stringValue(body.displayName);
  const email = stringValue(body.email).toLowerCase();
  const requestedTeamKey = stringValue(body.teamKey);
  const requestedTeamName = stringValue(body.teamName);
  const createTeam = body.createTeam === true;
  if (!displayName || !email || (!requestedTeamKey && !requestedTeamName)) {
    return Response.json({ error: "Name, email, and team are required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const lookupTeamKey = requestedTeamKey || slugify(requestedTeamName);
  const teamMembers = lookupTeamKey
    ? await base44.asServiceRole.entities.Participant.filter({ team_key: lookupTeamKey }, "display_name", 100)
    : [];
  const existingTeam = teamMembers.find((participant: any) => participant.active !== false) ?? null;
  let team;
  try {
    team = resolveExceptionTeam({ requestedTeamKey, requestedTeamName, createTeam, existingTeam });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Select an existing team" }, { status: 400 });
  }

  const existingParticipants = await base44.asServiceRole.entities.Participant.filter({ email }, undefined, 1);
  const existingParticipant = existingParticipants[0];
  if (existingParticipant && existingParticipant.active !== false) {
    return Response.json({ error: "A participant with this email already exists" }, { status: 409 });
  }

  const participantData = {
    email,
    display_name: displayName,
    team_key: team.teamKey,
    team_name: team.teamName,
    mentor_key: team.mentorKey,
    checked_in: false,
    checked_in_at: "",
    active: true,
    is_exception: true,
    access_key: existingParticipant?.access_key || crypto.randomUUID(),
    access_version: existingParticipant?.access_version || 1,
    access_enabled: true,
    access_expires_at: existingParticipant?.access_expires_at || "2026-08-01T21:00:00.000Z",
    access_email_status: existingParticipant?.access_email_status || "unsent",
  };
  const participant = existingParticipant
    ? await base44.asServiceRole.entities.Participant.update(existingParticipant.id, participantData)
    : await base44.asServiceRole.entities.Participant.create(participantData);
  const promo = body.assignPromo === true ? await getOptionalAssignablePromo(base44, email) : null;
  const assignedPromo = promo
    ? promo.assigned_email ? promo : await claimPromo(base44, promo, email)
    : null;

  return Response.json({
    participantId: participant.id,
    displayName,
    teamName: team.teamName,
    createdTeam: !existingTeam,
    promoLinks: assignedPromo ? promoLinks(assignedPromo) : null,
  });
}

export async function getAssignablePromo(base44: any, email: string) {
  const assignments = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: email }, undefined, 1);
  if (assignments[0]) {
    if (!findAvailablePromo(assignments)) throw new Error("The assigned promo pair is incomplete");
    return assignments[0];
  }
  const availableCodes = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: "" }, "created_date", 5000);
  const availablePromo = findAvailablePromo(availableCodes);
  if (!availablePromo) throw new Error("No complete promo pairs available");
  return availablePromo;
}

export async function reassignPromo(base44: any, email: string) {
  const assignments = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: email }, undefined, 1);
  const currentPromo = assignments[0] ?? null;
  const availableCodes = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: "" }, "created_date", 5000);
  const freshPromo = findAvailablePromo(availableCodes.filter((promo: any) => promo.id !== currentPromo?.id));
  if (!freshPromo) throw new Error("No complete promo pairs available");
  if (currentPromo) {
    await base44.asServiceRole.entities.PromoCode.update(currentPromo.id, { assigned_email: "", assigned_at: "", blocked: true });
  }
  return claimPromo(base44, freshPromo, email);
}

export async function claimPromo(base44: any, promo: any, email: string) {
  const assignedAt = new Date().toISOString();
  await base44.asServiceRole.entities.PromoCode.update(promo.id, { assigned_email: email, assigned_at: assignedAt });
  return { ...promo, assigned_email: email, assigned_at: assignedAt };
}

export function promoLinks(promo: any) {
  return { codexCredits: promo.codex_credit_url || promo.code, apiCredits: promo.api_credit_code || promo.api_credit_url };
}

async function getOptionalAssignablePromo(base44: any, email: string): Promise<any | null> {
  const assignments = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: email }, undefined, 1);
  if (assignments[0]) return findAvailablePromo(assignments) ?? null;
  const availableCodes = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: "" }, "created_date", 5000);
  return findAvailablePromo(availableCodes) ?? null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}
