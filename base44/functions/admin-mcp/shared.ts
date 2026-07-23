import { createClientFromRequest } from "npm:@base44/sdk";
import { z } from "npm:zod@4.4.3";

export type AdminClient = ReturnType<typeof createClientFromRequest>["asServiceRole"];
export type EntityRecord = Record<string, unknown> & { id: string };
export interface ParticipantRecord extends EntityRecord {
  email: string; display_name: string; team_key: string; team_name: string; mentor_key: string; checked_in: boolean;
  active?: boolean; checked_in_at?: string; is_exception?: boolean; access_key?: string; access_version?: number;
  access_enabled?: boolean; access_expires_at?: string; access_email_status?: "unsent" | "pending" | "accepted" | "failed" | "unknown";
  portal_first_seen_at?: string; portal_last_seen_at?: string; promo_claimed_at?: string;
  selected_photo_ids?: string[];
  phone?: string; linkedin?: string; custom_fields?: Record<string, string>;
}
export interface PageInput { query: string; limit: number; offset: number }
export interface ImportedParticipant {
  email: string; display_name: string; team_key: string; team_name: string; mentor_key: string;
  mentor_name: string; mentor_email: string; mentor_phone: string; mentor_details: string;
}

export const accessExpiresAt = "2026-08-01T21:00:00.000Z";
export const maxPageSize = 100;
export const annotations = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  write: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  destructive: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
} as const;

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(maxPageSize).default(25),
  offset: z.number().int().min(0).default(0),
});

export function result(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

export function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function page<T>(items: T[], offset: number, limit: number) {
  const pageItems = items.slice(offset, offset + limit);
  return { total_count: items.length, count: pageItems.length, offset, items: pageItems, has_more: offset + pageItems.length < items.length, next_offset: offset + pageItems.length };
}

export function publicParticipant(participant: Record<string, unknown>) {
  const { access_key: _accessKey, ...safe } = participant;
  return safe;
}

export function summarizeTeams(participants: Array<Record<string, unknown>>, mentorByKey: Map<unknown, unknown>, teamInfoByKey: Map<string, Record<string, unknown>> = new Map()) {
  const teams = new Map<string, { team_key: string; team_name: string; members: Array<{ id: string; display_name: string; email: string; checked_in: boolean }>; mentor_keys: Set<string> }>();
  for (const participant of participants) {
    const teamKey = String(participant.team_key);
    const team = teams.get(teamKey) ?? { team_key: teamKey, team_name: String(participant.team_name), members: [], mentor_keys: new Set<string>() };
    team.members.push({ id: String(participant.id), display_name: String(participant.display_name), email: String(participant.email), checked_in: participant.checked_in === true });
    team.mentor_keys.add(String(participant.mentor_key ?? ""));
    teams.set(teamKey, team);
  }
  return [...teams.values()].sort((left, right) => left.team_name.localeCompare(right.team_name)).map((team) => {
    const mentorKeys = [...team.mentor_keys];
    const mentorKey = mentorKeys.length === 1 ? mentorKeys[0]! : null;
    const teamInfo = teamInfoByKey.get(team.team_key);
    return { team_key: team.team_key, team_name: team.team_name, table_number: String(teamInfo?.table_number ?? ""), table_note: String(teamInfo?.note ?? ""), members: team.members, mentor_assignment: mentorKey === null ? { status: "mixed" } : mentorKey ? { status: "assigned", mentor_key: mentorKey, mentor_name: mentorByKey.get(mentorKey) ?? null } : { status: "unassigned" } };
  });
}

export function isAvailablePromo(promo: Record<string, unknown>) {
  return isCreditAvailable(promo) && Boolean(promo.codex_credit_url || promo.code) && Boolean(promo.api_credit_code || promo.api_credit_url);
}

export function isCreditAvailable(promo: Record<string, unknown>) {
  return !promo.assigned_email && promo.blocked !== true;
}

export function promoStatus(promo: Record<string, unknown>) {
  if (promo.assigned_email) return "assigned";
  if (promo.blocked === true) return "blocked";
  return isAvailablePromo(promo) ? "available" : "incomplete";
}

export function promoValues(promo: Record<string, unknown>) {
  return { codex_credits: promo.codex_credit_url || promo.code || null, api_credits: promo.api_credit_code || promo.api_credit_url || null };
}

export async function findParticipant(client: AdminClient, participantId: string, email: string) {
  if (participantId) return await client.entities.Participant.get(participantId) as ParticipantRecord | null;
  const matches = await client.entities.Participant.filter({ email: email.trim().toLocaleLowerCase() }, undefined, 2) as ParticipantRecord[];
  return matches.find((participant) => participant.active !== false) ?? matches[0] ?? null;
}

export async function invoke(client: AdminClient, name: string, data: Record<string, unknown>) {
  const response = await client.functions.invoke(name, data);
  return (response && typeof response === "object" && "data" in response ? response.data : response) as Record<string, unknown>;
}

export async function updateInBatches<T>(items: T[], update: (item: T) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += 20) await Promise.all(items.slice(index, index + 20).map(update));
}

export function reconcileParticipantRows(imported: ImportedParticipant[], existing: ParticipantRecord[]) {
  const existingByEmail = new Map(existing.map((participant) => [participant.email.toLocaleLowerCase(), participant]));
  const importedEmails = new Set(imported.map((participant) => participant.email.toLocaleLowerCase()));
  const creates: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const participant of imported) {
    const email = participant.email.toLocaleLowerCase();
    const previous = existingByEmail.get(email);
    const common = {
      email, display_name: participant.display_name, team_key: participant.team_key, team_name: participant.team_name,
      mentor_key: participant.mentor_key, active: true, access_enabled: true,
    };
    if (previous) {
      updates.push({ id: previous.id, data: {
        ...common,
        ...(previous.is_exception ? { is_exception: false } : {}),
        ...(!previous.access_key ? { access_key: crypto.randomUUID() } : {}),
        ...(!previous.access_version ? { access_version: 1 } : {}),
        ...(!previous.access_expires_at ? { access_expires_at: accessExpiresAt } : {}),
        ...(!previous.access_email_status ? { access_email_status: "unsent" } : {}),
      } });
      continue;
    }
    creates.push({
      ...common, checked_in: false, checked_in_at: "", is_exception: false, access_key: crypto.randomUUID(),
      access_version: 1, access_expires_at: accessExpiresAt, access_email_status: "unsent",
    });
  }
  const deactivations = existing.filter((participant) => !participant.is_exception && !importedEmails.has(participant.email.toLocaleLowerCase()))
    .map((participant) => ({ id: participant.id, data: { active: false, access_enabled: false } }));
  return { creates, updates, deactivations };
}

export function serializeCsv(headers: string[], rows: string[][]) {
  return [headers, ...rows].map((row) => row.map(serializeCsvField).join(",")).join("\r\n");
}

function serializeCsvField(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function normalizeParticipantName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function slugify(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
}
