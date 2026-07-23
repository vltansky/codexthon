import { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.29.0/server/webStandardStreamableHttp.js";
import { z } from "npm:zod@4.4.3";

import { loadPortalResponse } from "./portal-response.ts";
import {
  annotations, errorResult, findParticipant, invoke, isCreditAvailable, normalizeParticipantName, page, paginationSchema,
  promoStatus, promoValues, publicParticipant, reconcileParticipantRows, result, serializeCsv, slugify, summarizeTeams, updateInBatches,
  type AdminClient, type EntityRecord, type ImportedParticipant, type PageInput, type ParticipantRecord,
} from "./shared.ts";

export function createAdminMcpServer(client: AdminClient): McpServer {
  const server = new McpServer({ name: "build-week-admin-mcp", version: "1.1.0" });
  registerReadTools(server, client);
  registerMentorAndTeamTools(server, client);
  registerJudgingTools(server, client);
  registerParticipantTools(server, client);
  registerContentAndImportTools(server, client);
  return server;
}

export async function handleAdminMcpProtocolRequest(client: AdminClient, request: Request): Promise<Response> {
  const server = createAdminMcpServer(client);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

function registerReadTools(server: McpServer, client: AdminClient) {
  server.registerTool("build_week_get_status", {
    title: "Get event status",
    description: "Return concise counts for active participants, teams, mentors, judges, check-ins, portal opens, promo claims, promo inventory, and access-email state.",
    inputSchema: z.object({}).strict(), annotations: annotations.read,
  }, async () => {
    const [participants, mentors, judges, judgeGroups, promos] = await Promise.all([
      client.entities.Participant.list("display_name", 5000),
      client.entities.Mentor.list("display_name", 5000),
      client.entities.Judge.list("display_name", 5000),
      client.entities.JudgeGroup.list("name", 5000),
      client.entities.PromoCode.list("created_date", 5000),
    ]);
    const active = participants.filter((participant) => participant.active !== false);
    return result({
      participants: active.length,
      teams: new Set(active.map((participant) => participant.team_key)).size,
      mentors: mentors.length,
      judges: judges.length,
      judge_groups: judgeGroups.length,
      checked_in: active.filter((participant) => participant.checked_in === true).length,
      portal_opened: active.filter((participant) => Boolean(participant.portal_first_seen_at)).length,
      promos_claimed: active.filter((participant) => Boolean(participant.promo_claimed_at)).length,
      codex_credits_available: promos.filter((promo) => isCreditAvailable(promo) && Boolean(promo.codex_credit_url || promo.code)).length,
      api_credits_available: promos.filter((promo) => isCreditAvailable(promo) && Boolean(promo.api_credit_code || promo.api_credit_url)).length,
      promo_assignments: promos.filter((promo) => Boolean(promo.assigned_email)).length,
      promo_credits_blocked: promos.filter((promo) => promo.blocked === true).length,
      access_emails_pending: active.filter((participant) => participant.access_email_status === "pending").length,
      access_emails_accepted: active.filter((participant) => participant.access_email_status === "accepted").length,
    });
  });

  server.registerTool("build_week_list_participants", {
    title: "List participants",
    description: "Search active participants by name, email, or team. Access keys and promo credentials are never returned.",
    inputSchema: paginationSchema.extend({
      query: z.string().max(200).default(""),
      team_key: z.string().max(200).optional(),
      checked_in: z.boolean().optional(),
    }).strict(), annotations: annotations.read,
  }, async ({ query, team_key, checked_in, limit, offset }: PageInput & { team_key?: string; checked_in?: boolean }) => {
    const rows = await client.entities.Participant.list("display_name", 5000);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = rows.filter((participant) => participant.active !== false)
      .filter((participant) => team_key === undefined || participant.team_key === team_key)
      .filter((participant) => checked_in === undefined || participant.checked_in === checked_in)
      .filter((participant) => !normalizedQuery || [participant.display_name, participant.email, participant.team_name]
        .some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedQuery)))
      .map(publicParticipant);
    return result(page(filtered, offset, limit));
  });

  server.registerTool("build_week_get_participant", {
    title: "Get participant detail",
    description: "Return one participant's roster, team, mentor, promo, photo-shortlist, and access-email state by participant_id or email. Promo values and access keys are redacted.",
    inputSchema: z.object(participantSelectorFields).strict().refine(hasParticipantSelector, "Provide participant_id or email"), annotations: annotations.read,
  }, async ({ participant_id, email }: ParticipantSelector) => {
    const participant = await findParticipant(client, participant_id, email);
    if (!participant) return errorResult("Participant not found");
    const [mentors, teamMembers, promos, attempts] = await Promise.all([
      client.entities.Mentor.filter({ mentor_key: participant.mentor_key }, undefined, 1),
      client.entities.Participant.filter({ team_key: participant.team_key }, "display_name", 100),
      client.entities.PromoCode.filter({ assigned_email: participant.email.trim().toLocaleLowerCase() }, undefined, 1),
      client.entities.AccessDeliveryAttempt.filter({ participant_id: participant.id }, "-attempted_at", 20),
    ]);
    const promo = promos[0];
    return result({
      participant: publicParticipant(participant),
      has_access_key: Boolean(participant.access_key),
      selected_photo_count: Array.isArray(participant.selected_photo_ids) ? participant.selected_photo_ids.length : 0,
      mentor: mentors[0] ?? null,
      team_members: teamMembers.filter((member) => member.active !== false)
        .map((member) => ({ id: member.id, display_name: member.display_name, email: member.email, checked_in: member.checked_in === true })),
      promo: promo ? { id: promo.id, status: promoStatus(promo), assigned_at: promo.assigned_at || null } : null,
      access_deliveries: attempts.map(deliveryAttempt),
    });
  });

  server.registerTool("build_week_preview_participant_portal", {
    title: "Preview participant portal",
    description: "Return the exact portal payload a participant sees: their profile, team members, mentor, event content, and promo state. Wi-Fi passwords and promo values are redacted unless include_credentials=true.",
    inputSchema: z.object({ ...participantSelectorFields, include_credentials: z.boolean().default(false) }).strict().refine(hasParticipantSelector, "Provide participant_id or email"), annotations: annotations.read,
  }, async ({ participant_id, email, include_credentials }: ParticipantSelector & { include_credentials: boolean }) => {
    const participant = await findParticipant(client, participant_id, email);
    if (!participant) return errorResult("Participant not found");
    const portal = await loadPortalResponse({ asServiceRole: client }, participant);
    if (include_credentials) return result({ portal });
    return result({ portal: {
      ...portal,
      settings: portal.settings ? { ...portal.settings, wifiPassword: redacted(portal.settings.wifiPassword), wifiPasswordSecondary: redacted(portal.settings.wifiPasswordSecondary) } : null,
      promoLinks: { codexCredits: redacted(portal.promoLinks.codexCredits), apiCredits: redacted(portal.promoLinks.apiCredits) },
    } });
  });

  server.registerTool("build_week_list_mentors", {
    title: "List mentors",
    description: "List mentors with contact details and current team and participant counts.",
    inputSchema: paginationSchema.extend({ query: z.string().max(200).default("") }).strict(), annotations: annotations.read,
  }, async ({ query, limit, offset }: PageInput) => {
    const [mentors, participants] = await Promise.all([
      client.entities.Mentor.list("display_name", 5000),
      client.entities.Participant.list("display_name", 5000),
    ]);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const items = mentors.filter((mentor) => !normalizedQuery || [mentor.display_name, mentor.email, mentor.phone, mentor.details]
      .some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedQuery)))
      .map((mentor) => {
        const assigned = participants.filter((participant) => participant.active !== false && participant.mentor_key === mentor.mentor_key);
        return { ...mentor, participant_count: assigned.length, team_count: new Set(assigned.map((participant) => participant.team_key)).size };
      });
    return result(page(items, offset, limit));
  });

  server.registerTool("build_week_list_teams", {
    title: "List teams",
    description: "List teams, members, assigned tables, and mentor assignment consistency. A mixed assignment means members currently reference different mentors.",
    inputSchema: paginationSchema.extend({ query: z.string().max(200).default("") }).strict(), annotations: annotations.read,
  }, async ({ query, limit, offset }: PageInput) => {
    const [participants, mentors, teamInfos] = await Promise.all([
      client.entities.Participant.list("team_name", 5000),
      client.entities.Mentor.list("display_name", 5000),
      client.entities.TeamInfo.list("team_key", 5000),
    ]);
    const mentorByKey = new Map(mentors.map((mentor) => [mentor.mentor_key, mentor.display_name]));
    const teamInfoByKey = new Map(teamInfos.map((info) => [String(info.team_key), info]));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const teams = summarizeTeams(participants.filter((participant) => participant.active !== false), mentorByKey, teamInfoByKey)
      .filter((team) => !normalizedQuery || [team.team_name, ...team.members.map((member) => member.display_name)]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
    return result(page(teams, offset, limit));
  });

  server.registerTool("build_week_list_promos", {
    title: "List promo inventory",
    description: "List promo assignment state. Incomplete rows are missing one half of the Codex/API pair. Values are redacted unless include_values=true because promo links and codes are credentials.",
    inputSchema: paginationSchema.extend({
      status: z.enum(["all", "available", "assigned", "blocked", "incomplete"]).default("all"),
      include_values: z.boolean().default(false),
    }).strict(), annotations: annotations.read,
  }, async ({ status, include_values, limit, offset }: { status: "all" | "available" | "assigned" | "blocked" | "incomplete"; include_values: boolean; limit: number; offset: number }) => {
    const promos = await client.entities.PromoCode.list("created_date", 5000);
    const filtered = promos.filter((promo) => status === "all" || promoStatus(promo) === status);
    const items = filtered.map((promo) => ({
      id: promo.id,
      status: promoStatus(promo),
      assigned_email: promo.assigned_email || null,
      assigned_at: promo.assigned_at || null,
      ...(include_values ? promoValues(promo) : {}),
    }));
    return result(page(items, offset, limit));
  });

  server.registerTool("build_week_list_access_deliveries", {
    title: "List access email deliveries",
    description: "Read the append-only audit trail of personal access-link email attempts, most recent first. Use it to explain why a participant did or did not receive their link.",
    inputSchema: paginationSchema.extend({
      participant_email: z.string().max(320).default(""),
      status: z.enum(["all", "pending", "accepted", "failed", "unknown", "skipped"]).default("all"),
    }).strict(), annotations: annotations.read,
  }, async ({ participant_email, status, limit, offset }: { participant_email: string; status: string; limit: number; offset: number }) => {
    const attempts = await client.entities.AccessDeliveryAttempt.list("-attempted_at", 5000);
    const normalizedEmail = participant_email.trim().toLocaleLowerCase();
    const items = attempts
      .filter((attempt) => !normalizedEmail || String(attempt.participant_email ?? "").toLocaleLowerCase() === normalizedEmail)
      .filter((attempt) => status === "all" || attempt.status === status)
      .map(deliveryAttempt);
    return result(page(items, offset, limit));
  });

  server.registerTool("build_week_get_content", {
    title: "Get event content",
    description: "Get participant-facing event content. Wi-Fi passwords are redacted unless include_sensitive=true.",
    inputSchema: z.object({ include_sensitive: z.boolean().default(false) }).strict(), annotations: annotations.read,
  }, async ({ include_sensitive }: { include_sensitive: boolean }) => {
    const settings = (await client.entities.EventSettings.list("-updated_date", 1))[0];
    if (!settings) return result({ settings: null });
    const { wifi_password, wifi_password_secondary, ...publicSettings } = settings;
    return result({ settings: include_sensitive ? settings : { ...publicSettings, wifi_password: wifi_password ? "[redacted]" : "", wifi_password_secondary: wifi_password_secondary ? "[redacted]" : "" } });
  });

  server.registerTool("build_week_export_csv", {
    title: "Export roster CSV",
    description: "Export the participant, mentor, judge, or team roster as CSV text with the same columns as the admin page exports. Access keys and promo credential values are never included.",
    inputSchema: z.object({ dataset: z.enum(["participants", "mentors", "teams", "judges"]) }).strict(), annotations: annotations.read,
  }, async ({ dataset }: { dataset: ExportDataset }) => {
    const [participants, mentors, judges, judgeGroups, promos, teamInfos] = await Promise.all([
      client.entities.Participant.list("display_name", 5000),
      client.entities.Mentor.list("display_name", 5000),
      client.entities.Judge.list("display_name", 5000),
      client.entities.JudgeGroup.list("name", 5000),
      client.entities.PromoCode.list("created_date", 5000),
      client.entities.TeamInfo.list("team_key", 5000),
    ]);
    const active = participants.filter((participant) => participant.active !== false) as ParticipantRecord[];
    const { headers, rows } = exportRows(dataset, active, mentors, promos, judges, judgeGroups, teamInfos);
    return result({ dataset, row_count: rows.length, csv: serializeCsv(headers, rows) });
  });
}

const personFields = {
  display_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().or(z.literal("")).default(""),
  phone: z.string().trim().max(100).default(""),
  linkedin: z.string().trim().url().or(z.literal("")).default(""),
  details: z.string().trim().max(3000).default(""),
};

interface PersonInput { display_name: string; email: string; phone: string; linkedin: string; details: string }

function registerMentorAndTeamTools(server: McpServer, client: AdminClient) {
  const mentorFields = personFields;

  server.registerTool("build_week_add_mentor", {
    title: "Add mentor", description: "Create a mentor record for later team assignment.",
    inputSchema: z.object(mentorFields).strict(), annotations: annotations.write,
  }, async (input: { display_name: string; email: string; phone: string; linkedin: string; details: string }) => {
    const mentorKey = input.email.toLocaleLowerCase() || slugify(input.display_name);
    const existing = await client.entities.Mentor.filter({ mentor_key: mentorKey }, undefined, 1);
    if (existing.length) return errorResult("A mentor with this email or name already exists");
    return result({ mentor: await client.entities.Mentor.create({ mentor_key: mentorKey, ...input, email: input.email.toLocaleLowerCase() }) });
  });

  server.registerTool("build_week_update_mentor", {
    title: "Update mentor", description: "Update mentor contact or guidance details without changing the stable mentor key.",
    inputSchema: z.object({ mentor_id: z.string().min(1), ...mentorFields }).strict(), annotations: annotations.write,
  }, async ({ mentor_id, ...data }: { mentor_id: string; display_name: string; email: string; phone: string; linkedin: string; details: string }) => result({ mentor: await client.entities.Mentor.update(mentor_id, { ...data, email: data.email.toLocaleLowerCase() }) }));

  server.registerTool("build_week_delete_mentor", {
    title: "Delete mentor", description: "Delete a mentor and clear that mentor assignment from all affected active participants and judge groups.",
    inputSchema: z.object({ mentor_id: z.string().min(1), confirm: z.literal("DELETE MENTOR") }).strict(), annotations: annotations.destructive,
  }, async ({ mentor_id }: { mentor_id: string; confirm: "DELETE MENTOR" }) => {
    const mentor = await client.entities.Mentor.get(mentor_id);
    const assigned = await client.entities.Participant.filter({ mentor_key: mentor.mentor_key }, "display_name", 5000);
    await updateInBatches(assigned, (participant) => client.entities.Participant.update(participant.id, { mentor_key: "" }));
    const clearedGroups = await removeMemberFromGroups(client, "mentor_keys", String(mentor.mentor_key));
    await client.entities.Mentor.delete(mentor_id);
    return result({ deleted_mentor_id: mentor_id, cleared_participant_assignments: assigned.length, cleared_judge_groups: clearedGroups });
  });

  server.registerTool("build_week_assign_mentor_to_team", {
    title: "Assign mentor to team", description: "Assign one mentor to every active participant in a team. Pass an empty mentor_id to clear the assignment.",
    inputSchema: z.object({ team_key: z.string().min(1), mentor_id: z.string().default("") }).strict(), annotations: annotations.write,
  }, async ({ team_key, mentor_id }: { team_key: string; mentor_id: string }) => {
    const mentor = mentor_id ? await client.entities.Mentor.get(mentor_id) : null;
    const members = (await client.entities.Participant.filter({ team_key }, "display_name", 5000)).filter((participant) => participant.active !== false);
    if (!members.length) return errorResult("No active team found for this team_key");
    await updateInBatches(members, (participant) => client.entities.Participant.update(participant.id, { mentor_key: mentor?.mentor_key ?? "" }));
    return result({ team_key, mentor: mentor ? { id: mentor.id, display_name: mentor.display_name } : null, updated_participants: members.length });
  });

  server.registerTool("build_week_set_team_table", {
    title: "Set team table", description: "Assign a team's table number and an optional location note, both shown on the participant portal, e.g. table 12, floor 2 near the fridge. Pass empty values to clear.",
    inputSchema: z.object({ team_key: z.string().min(1), table_number: z.string().trim().max(50).default(""), note: z.string().trim().max(500).default("") }).strict(), annotations: annotations.write,
  }, async ({ team_key, table_number, note }: { team_key: string; table_number: string; note: string }) => {
    const members = (await client.entities.Participant.filter({ team_key }, "display_name", 5000)).filter((participant) => participant.active !== false);
    if (!members.length) return errorResult("No active team found for this team_key");
    const existing = (await client.entities.TeamInfo.filter({ team_key }, undefined, 1))[0];
    if (existing) await client.entities.TeamInfo.update(existing.id, { table_number, note });
    if (!existing) await client.entities.TeamInfo.create({ team_key, table_number, note });
    return result({ team_key, table_number, note });
  });
}

function registerJudgingTools(server: McpServer, client: AdminClient) {
  server.registerTool("build_week_list_judges", {
    title: "List judges",
    description: "List judges with contact details and how many judge groups and teams include them.",
    inputSchema: paginationSchema.extend({ query: z.string().max(200).default("") }).strict(), annotations: annotations.read,
  }, async ({ query, limit, offset }: PageInput) => {
    const [judges, groups] = await Promise.all([
      client.entities.Judge.list("display_name", 5000),
      client.entities.JudgeGroup.list("name", 5000),
    ]);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const items = judges.filter((judge) => !normalizedQuery || [judge.display_name, judge.email, judge.phone, judge.details]
      .some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedQuery)))
      .map((judge) => {
        const memberOf = groups.filter((group) => stringArray(group.judge_keys).includes(String(judge.judge_key)));
        return { ...judge, group_count: memberOf.length, team_count: new Set(memberOf.flatMap((group) => stringArray(group.team_keys))).size };
      });
    return result(page(items, offset, limit));
  });

  server.registerTool("build_week_add_judge", {
    title: "Add judge", description: "Create a judge record for judge-group membership.",
    inputSchema: z.object(personFields).strict(), annotations: annotations.write,
  }, async (input: PersonInput) => {
    const judgeKey = input.email.toLocaleLowerCase() || slugify(input.display_name);
    const existing = await client.entities.Judge.filter({ judge_key: judgeKey }, undefined, 1);
    if (existing.length) return errorResult("A judge with this email or name already exists");
    return result({ judge: await client.entities.Judge.create({ judge_key: judgeKey, ...input, email: input.email.toLocaleLowerCase() }) });
  });

  server.registerTool("build_week_update_judge", {
    title: "Update judge", description: "Update judge contact details without changing the stable judge key.",
    inputSchema: z.object({ judge_id: z.string().min(1), ...personFields }).strict(), annotations: annotations.write,
  }, async ({ judge_id, ...data }: { judge_id: string } & PersonInput) => result({ judge: await client.entities.Judge.update(judge_id, { ...data, email: data.email.toLocaleLowerCase() }) }));

  server.registerTool("build_week_delete_judge", {
    title: "Delete judge", description: "Delete a judge and remove them from all judge groups.",
    inputSchema: z.object({ judge_id: z.string().min(1), confirm: z.literal("DELETE JUDGE") }).strict(), annotations: annotations.destructive,
  }, async ({ judge_id }: { judge_id: string; confirm: "DELETE JUDGE" }) => {
    const judge = await client.entities.Judge.get(judge_id);
    if (!judge) return errorResult("Judge not found");
    const clearedGroups = await removeMemberFromGroups(client, "judge_keys", String(judge.judge_key));
    await client.entities.Judge.delete(judge_id);
    return result({ deleted_judge_id: judge_id, cleared_judge_groups: clearedGroups });
  });

  server.registerTool("build_week_list_judge_groups", {
    title: "List judge groups",
    description: "List judging panels with resolved mentor, judge, and team names. A null team_name marks a stale team key.",
    inputSchema: paginationSchema.extend({ query: z.string().max(200).default("") }).strict(), annotations: annotations.read,
  }, async ({ query, limit, offset }: PageInput) => {
    const [groups, mentors, judges, participants] = await Promise.all([
      client.entities.JudgeGroup.list("name", 5000),
      client.entities.Mentor.list("display_name", 5000),
      client.entities.Judge.list("display_name", 5000),
      client.entities.Participant.list("team_name", 5000),
    ]);
    const mentorNames = new Map(mentors.map((mentor) => [String(mentor.mentor_key), mentor.display_name]));
    const judgeNames = new Map(judges.map((judge) => [String(judge.judge_key), judge.display_name]));
    const teamNames = new Map(participants.filter((participant) => participant.active !== false)
      .map((participant) => [String(participant.team_key), participant.team_name]));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const items = groups.filter((group) => !normalizedQuery || String(group.name ?? "").toLocaleLowerCase().includes(normalizedQuery))
      .map((group) => ({
        id: group.id, group_key: group.group_key, name: group.name, details: group.details ?? "",
        mentors: stringArray(group.mentor_keys).map((key) => ({ key, display_name: mentorNames.get(key) ?? null })),
        judges: stringArray(group.judge_keys).map((key) => ({ key, display_name: judgeNames.get(key) ?? null })),
        teams: stringArray(group.team_keys).map((team_key) => ({ team_key, team_name: teamNames.get(team_key) ?? null })),
      }));
    return result(page(items, offset, limit));
  });

  const groupMemberFields = {
    name: z.string().trim().min(1).max(200),
    details: z.string().trim().max(3000).default(""),
    mentor_keys: z.array(z.string().min(1)).max(100).default([]),
    judge_keys: z.array(z.string().min(1)).max(100).default([]),
  };

  server.registerTool("build_week_create_judge_group", {
    title: "Create judge group", description: "Create a judging panel from existing mentors and judges. Teams are assigned separately.",
    inputSchema: z.object(groupMemberFields).strict(), annotations: annotations.write,
  }, async ({ name, details, mentor_keys, judge_keys }: GroupMemberInput) => {
    const groupKey = slugify(name);
    const existing = await client.entities.JudgeGroup.filter({ group_key: groupKey }, undefined, 1);
    if (existing.length) return errorResult("A judge group with this name already exists");
    const unknown = await unknownMemberKeys(client, mentor_keys, judge_keys);
    if (unknown.length) return errorResult(`Unknown member keys: ${unknown.join(", ")}`);
    return result({ group: await client.entities.JudgeGroup.create({ group_key: groupKey, name, details, mentor_keys, judge_keys, team_keys: [] }) });
  });

  server.registerTool("build_week_update_judge_group", {
    title: "Update judge group", description: "Update a judging panel's name, details, and members without changing the stable group key or team assignments.",
    inputSchema: z.object({ group_id: z.string().min(1), ...groupMemberFields }).strict(), annotations: annotations.write,
  }, async ({ group_id, name, details, mentor_keys, judge_keys }: { group_id: string } & GroupMemberInput) => {
    const unknown = await unknownMemberKeys(client, mentor_keys, judge_keys);
    if (unknown.length) return errorResult(`Unknown member keys: ${unknown.join(", ")}`);
    return result({ group: await client.entities.JudgeGroup.update(group_id, { name, details, mentor_keys, judge_keys }) });
  });

  server.registerTool("build_week_delete_judge_group", {
    title: "Delete judge group", description: "Delete a judging panel. Member and team records are not affected.",
    inputSchema: z.object({ group_id: z.string().min(1), confirm: z.literal("DELETE JUDGE GROUP") }).strict(), annotations: annotations.destructive,
  }, async ({ group_id }: { group_id: string; confirm: "DELETE JUDGE GROUP" }) => {
    await client.entities.JudgeGroup.delete(group_id);
    return result({ deleted_group_id: group_id });
  });

  server.registerTool("build_week_assign_teams_to_judge_group", {
    title: "Assign teams to judge group", description: "Replace a judging panel's team list. Each team belongs to at most one panel, so listed teams are removed from other panels. Pass an empty list to clear the panel.",
    inputSchema: z.object({ group_id: z.string().min(1), team_keys: z.array(z.string().min(1)).max(200).default([]) }).strict(), annotations: annotations.write,
  }, async ({ group_id, team_keys }: { group_id: string; team_keys: string[] }) => {
    const group = await client.entities.JudgeGroup.get(group_id);
    if (!group) return errorResult("Judge group not found");
    const participants = await client.entities.Participant.list("team_name", 5000);
    const activeTeamKeys = new Set(participants.filter((participant) => participant.active !== false).map((participant) => String(participant.team_key)));
    const unknown = team_keys.filter((key) => !activeTeamKeys.has(key));
    if (unknown.length) return errorResult(`No active team found for: ${unknown.join(", ")}`);
    const requested = new Set(team_keys);
    const groups = await client.entities.JudgeGroup.list("name", 5000);
    const others = groups.filter((other) => other.id !== group_id && stringArray(other.team_keys).some((key) => requested.has(key)));
    await updateInBatches(others, (other) => client.entities.JudgeGroup.update(other.id, { team_keys: stringArray(other.team_keys).filter((key) => !requested.has(key)) }));
    await client.entities.JudgeGroup.update(group_id, { team_keys });
    return result({ group_id, team_keys, removed_from_groups: others.length });
  });
}

interface GroupMemberInput { name: string; details: string; mentor_keys: string[]; judge_keys: string[] }

async function removeMemberFromGroups(client: AdminClient, field: "mentor_keys" | "judge_keys", memberKey: string) {
  const groups = await client.entities.JudgeGroup.list("name", 5000);
  const affected = groups.filter((group) => stringArray(group[field]).includes(memberKey));
  await updateInBatches(affected, (group) => client.entities.JudgeGroup.update(group.id, { [field]: stringArray(group[field]).filter((key) => key !== memberKey) }));
  return affected.length;
}

async function unknownMemberKeys(client: AdminClient, mentorKeys: string[], judgeKeys: string[]) {
  const [mentors, judges] = await Promise.all([
    client.entities.Mentor.list("display_name", 5000),
    client.entities.Judge.list("display_name", 5000),
  ]);
  const knownMentors = new Set(mentors.map((mentor) => String(mentor.mentor_key)));
  const knownJudges = new Set(judges.map((judge) => String(judge.judge_key)));
  return [...mentorKeys.filter((key) => !knownMentors.has(key)), ...judgeKeys.filter((key) => !knownJudges.has(key))];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function registerParticipantTools(server: McpServer, client: AdminClient) {
  server.registerTool("build_week_add_participant_exception", {
    title: "Add participant exception", description: "Add an approved guest missing from the imported roster. Pass team_key for an existing team, or team_name with create_team=true to start a new team without a mentor. Optionally assign a promo pair.",
    inputSchema: z.object({
      display_name: z.string().trim().min(1).max(200), email: z.string().email(),
      team_key: z.string().max(200).default(""), team_name: z.string().max(300).default(""),
      create_team: z.boolean().default(false), assign_promo: z.boolean().default(false),
    }).strict().refine((value) => Boolean(value.team_key || value.team_name), "Provide team_key or team_name"),
    annotations: annotations.write,
  }, async ({ display_name, email, team_key, team_name, create_team, assign_promo }: { display_name: string; email: string; team_key: string; team_name: string; create_team: boolean; assign_promo: boolean }) =>
    result(await invoke(client, "check-in-participants", { action: "add-exception", displayName: display_name, email, teamKey: team_key, teamName: team_name, createTeam: create_team, assignPromo: assign_promo })));

  server.registerTool("build_week_set_check_in", {
    title: "Set participant check-in", description: "Check participants in or out by email, one or many at a time. Check-in assigns an available complete promo pair exactly once.",
    inputSchema: z.object({
      updates: z.array(z.object({ email: z.string().email(), checked_in: z.boolean() }).strict()).min(1).max(500),
    }).strict(), annotations: annotations.write,
  }, async ({ updates }: { updates: Array<{ email: string; checked_in: boolean }> }) =>
    result(await invoke(client, "check-in-participants", { updates: updates.map(({ email, checked_in }) => ({ email, checkedIn: checked_in })) })));

  server.registerTool("build_week_update_participant", {
    title: "Update participant profile", description: "Update a participant's phone, LinkedIn, or custom profile fields by participant_id or email. Omitted fields remain unchanged; custom_fields replaces the whole map.",
    inputSchema: z.object({
      ...participantSelectorFields,
      phone: z.string().trim().max(100).optional(),
      linkedin: z.string().trim().url().or(z.literal("")).optional(),
      custom_fields: z.record(z.string().trim().min(1).max(100), z.string().max(2000)).optional(),
    }).strict()
      .refine(hasParticipantSelector, "Provide participant_id or email")
      .refine((value) => value.phone !== undefined || value.linkedin !== undefined || value.custom_fields !== undefined, "Provide at least one profile field"),
    annotations: annotations.write,
  }, async ({ participant_id, email, phone, linkedin, custom_fields }: ParticipantSelector & { phone?: string; linkedin?: string; custom_fields?: Record<string, string> }) => {
    const participant = await findParticipant(client, participant_id, email);
    if (!participant) return errorResult("Participant not found");
    const data = {
      ...(phone !== undefined ? { phone } : {}),
      ...(linkedin !== undefined ? { linkedin } : {}),
      ...(custom_fields !== undefined ? { custom_fields } : {}),
    };
    return result({ participant: publicParticipant(await client.entities.Participant.update(participant.id, data)) });
  });

  server.registerTool("build_week_change_participant_email", {
    title: "Change participant email", description: "Move a participant to a corrected email address, carrying over their check-in state, promo assignment, and personal access link.",
    inputSchema: z.object({ participant_id: z.string().min(1), email: z.string().email() }).strict(), annotations: annotations.write,
  }, async ({ participant_id, email }: { participant_id: string; email: string }) =>
    result(await invoke(client, "check-in-participants", { action: "update-email", participantId: participant_id, email })));

  server.registerTool("build_week_assign_promo", {
    title: "Assign promo pair", description: "Assign or return one participant's promo pair. The response contains credential values and must not be shared broadly.",
    inputSchema: z.object({ participant_id: z.string().min(1) }).strict(), annotations: annotations.write,
  }, async ({ participant_id }: { participant_id: string }) => result(await invoke(client, "check-in-participants", { action: "assign-promo", participantId: participant_id })));

  server.registerTool("build_week_reassign_promo", {
    title: "Reassign promo pair", description: "Retire a participant's current promo pair (the old row is blocked from reuse) and assign a fresh pair from the available pool. The response contains credential values and must not be shared broadly.",
    inputSchema: z.object({ participant_id: z.string().min(1), confirm: z.literal("REASSIGN PROMO") }).strict(), annotations: annotations.destructive,
  }, async ({ participant_id }: { participant_id: string; confirm: "REASSIGN PROMO" }) =>
    result(await invoke(client, "check-in-participants", { action: "reassign-promo", participantId: participant_id })));

  server.registerTool("build_week_set_promo_blocked", {
    title: "Block or unblock promo credits", description: "Exclude an unassigned promo row from automatic assignment, or return it to the available pool. Assigned rows cannot be blocked.",
    inputSchema: z.object({ promo_id: z.string().min(1), blocked: z.boolean() }).strict(), annotations: annotations.write,
  }, async ({ promo_id, blocked }: { promo_id: string; blocked: boolean }) => {
    const promo = await client.entities.PromoCode.get(promo_id);
    if (!promo) return errorResult("Promo row not found");
    if (promo.assigned_email) return errorResult("This promo pair is already assigned and cannot be blocked");
    await client.entities.PromoCode.update(promo_id, { blocked });
    return result({ promo: { id: promo_id, status: promoStatus({ ...promo, blocked }) } });
  });

  server.registerTool("build_week_get_access_link", {
    title: "Get personal access link", description: "Return a checked-in participant's signed personal access link, initializing missing access identity fields if needed. The link is a bearer credential; do not log or share it broadly.",
    inputSchema: z.object({ participant_id: z.string().min(1) }).strict(), annotations: annotations.write,
  }, async ({ participant_id }: { participant_id: string }) => result(await invoke(client, "access-admin", { action: "links", participantIds: [participant_id] })));

  server.registerTool("build_week_rotate_access_link", {
    title: "Rotate personal access link", description: "Invalidate a participant's previous personal link and return a new signed link. This disrupts previously delivered links.",
    inputSchema: z.object({ participant_id: z.string().min(1), confirm: z.literal("ROTATE ACCESS LINK") }).strict(), annotations: annotations.destructive,
  }, async ({ participant_id }: { participant_id: string; confirm: "ROTATE ACCESS LINK" }) => result(await invoke(client, "access-admin", { action: "rotate", participantId: participant_id })));

  server.registerTool("build_week_send_access_email", {
    title: "Send personal access email", description: "Send or resend one checked-in participant's personal event link through the configured Gmail connector.",
    inputSchema: z.object({ participant_id: z.string().min(1) }).strict(), annotations: annotations.write,
  }, async ({ participant_id }: { participant_id: string }) => result(await invoke(client, "access-admin", { action: "email", participantId: participant_id })));

  server.registerTool("build_week_send_access_emails", {
    title: "Send access emails", description: "Send personal links to selected participants, all eligible unsent participants, or explicit resends. Processes at most 25 recipients per call and reports whether more remain.",
    inputSchema: z.object({
      mode: z.enum(["selected", "all_unsent", "resend"]),
      participant_ids: z.array(z.string().min(1)).max(100).default([]),
      exclude_participant_ids: z.array(z.string().min(1)).max(100).default([]),
      request_id: z.string().uuid().default(() => crypto.randomUUID()),
    }).strict(), annotations: annotations.write,
  }, async ({ mode, participant_ids, exclude_participant_ids, request_id }: { mode: "selected" | "all_unsent" | "resend"; participant_ids: string[]; exclude_participant_ids: string[]; request_id: string }) => result(await invoke(client, "access-admin", { action: "send", mode, participantIds: participant_ids, excludeParticipantIds: exclude_participant_ids, requestId: request_id })));
}

function registerContentAndImportTools(server: McpServer, client: AdminClient) {
  const contentFields = {
    event_name: z.string().trim().max(300).optional(), event_url: z.string().trim().url().or(z.literal("")).optional(),
    wifi_network: z.string().trim().max(200).optional(), wifi_password: z.string().max(300).optional(),
    wifi_network_secondary: z.string().trim().max(200).optional(), wifi_password_secondary: z.string().max(300).optional(),
    event_details: z.string().max(10000).optional(), agenda: z.string().max(20000).optional(),
    questions_and_answers: z.string().max(30000).optional(), promo_instructions: z.string().max(10000).optional(),
    partner_coupon_code: z.string().max(500).optional(), partner_registration_url: z.string().trim().url().or(z.literal("")).optional(),
  };
  server.registerTool("build_week_update_content", {
    title: "Update event content", description: "Update selected participant-facing event, venue, agenda, Q&A, or promo-instruction fields. Omitted fields remain unchanged.",
    inputSchema: z.object(contentFields).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one content field"), annotations: annotations.write,
  }, async (data: Record<string, string | undefined>) => {
    const current = (await client.entities.EventSettings.list("-updated_date", 1))[0];
    const settings = current ? await client.entities.EventSettings.update(current.id, data) : await client.entities.EventSettings.create({ event_name: data.event_name || "Community event", ...data });
    return result({ settings_id: settings.id, updated_fields: Object.keys(data) });
  });

  server.registerTool("build_week_replace_participants", {
    title: "Replace participant roster", description: "Replace the active roster from validated approved-Luma/enriched rows while preserving check-in, promo assignment, and personal access identity. Parse CSV into these rows before calling.",
    inputSchema: z.object({ participants: z.array(z.object({
      email: z.string().email(), display_name: z.string().min(1).max(200), team_key: z.string().min(1).max(200), team_name: z.string().min(1).max(300),
      mentor_key: z.string().min(1).max(300), mentor_name: z.string().max(200).default("Mentor TBD"), mentor_email: z.string().email().or(z.literal("")).default(""),
      mentor_phone: z.string().max(100).default(""), mentor_details: z.string().max(3000).default(""),
    }).strict()).min(1).max(5000) }).strict(), annotations: annotations.write,
  }, async ({ participants: imported }: { participants: ImportedParticipant[] }) => {
    const existing = await client.entities.Participant.list("display_name", 5000) as ParticipantRecord[];
    const reconciliation = reconcileParticipantRows(imported, existing);
    const mentors = new Map(imported.map((row) => [row.mentor_key, { mentor_key: row.mentor_key, display_name: row.mentor_name, email: row.mentor_email, phone: row.mentor_phone, details: row.mentor_details }]));
    await client.entities.Mentor.deleteMany({});
    if (reconciliation.creates.length) await client.entities.Participant.bulkCreate(reconciliation.creates);
    await updateInBatches([...reconciliation.updates, ...reconciliation.deactivations], ({ id, data }) => client.entities.Participant.update(id, data));
    if (mentors.size) await client.entities.Mentor.bulkCreate([...mentors.values()]);
    return result({ imported: imported.length, preserved: reconciliation.updates.length, deactivated: reconciliation.deactivations.length, mentors: mentors.size });
  });

  server.registerTool("build_week_import_mentor_teams", {
    title: "Import mentor teams", description: "Import parsed Mentors worksheet rows and assign exact, unique participant-name matches to teams and mentors.",
    inputSchema: z.object({ teams: z.array(z.object({
      team_key: z.string().min(1).max(200), team_name: z.string().min(1).max(300), mentor_key: z.string().min(1).max(300),
      mentor_name: z.string().min(1).max(200), mentor_details: z.string().max(3000).default(""), member_names: z.array(z.string().min(1).max(200)).max(100),
    }).strict()).min(1).max(500) }).strict(), annotations: annotations.write,
  }, async ({ teams }: { teams: Array<{ team_key: string; team_name: string; mentor_key: string; mentor_name: string; mentor_details: string; member_names: string[] }> }) => {
    const participants = (await client.entities.Participant.list("display_name", 5000) as ParticipantRecord[]).filter((participant) => participant.active !== false);
    const participantsByName = new Map<string, EntityRecord[]>();
    for (const participant of participants) {
      const key = normalizeParticipantName(String(participant.display_name));
      participantsByName.set(key, [...(participantsByName.get(key) ?? []), participant]);
    }
    const mentors = await client.entities.Mentor.list("display_name", 5000);
    const mentorsByKey = new Map(mentors.map((mentor) => [mentor.mentor_key, mentor]));
    const assignments: Array<{ participant: EntityRecord; teamKey: string; teamName: string; mentorKey: string }> = [];
    let unmatched = 0;
    for (const team of teams) {
      const existing = mentorsByKey.get(team.mentor_key);
      const data = { mentor_key: team.mentor_key, display_name: team.mentor_name, details: team.mentor_details || existing?.details || "" };
      const mentor = existing ? await client.entities.Mentor.update(existing.id, data) : await client.entities.Mentor.create(data);
      mentorsByKey.set(team.mentor_key, mentor);
      for (const name of team.member_names) {
        const matches = participantsByName.get(normalizeParticipantName(name)) ?? [];
        if (matches.length !== 1) { unmatched += 1; continue; }
        assignments.push({ participant: matches[0]!, teamKey: team.team_key, teamName: team.team_name, mentorKey: team.mentor_key });
      }
    }
    await updateInBatches(assignments, ({ participant, teamKey, teamName, mentorKey }) => client.entities.Participant.update(participant.id, { team_key: teamKey, team_name: teamName, mentor_key: mentorKey }));
    return result({ teams: teams.length, assigned_participants: new Set(assignments.map(({ participant }) => participant.id)).size, unmatched_names: unmatched });
  });

  server.registerTool("build_week_import_promos", {
    title: "Import promo pairs", description: "Import validated Codex/API promo pairs without changing existing assignments. Parse combined or separate allocation CSV files into pairs before calling.",
    inputSchema: z.object({ promo_pairs: z.array(z.object({ codex_credits: z.string().url(), api_credits: z.string().min(1).max(2000) }).strict()).min(1).max(5000) }).strict(), annotations: annotations.write,
  }, async ({ promo_pairs }: { promo_pairs: Array<{ codex_credits: string; api_credits: string }> }) => {
    const bundles = promo_pairs.map((pair) => ({ codexCreditUrl: pair.codex_credits, apiCreditValue: pair.api_credits }));
    const existing = await client.entities.PromoCode.list("created_date", 5000);
    const byCodex = new Map(existing.map((promo) => [promo.codex_credit_url || promo.code, promo]));
    let added = 0;
    let completed = 0;
    for (const bundle of bundles) {
      const promo = byCodex.get(bundle.codexCreditUrl);
      const apiFields = /^https?:\/\//i.test(bundle.apiCreditValue) ? { api_credit_url: bundle.apiCreditValue, api_credit_code: "" } : { api_credit_url: "", api_credit_code: bundle.apiCreditValue };
      if (!promo) {
        await client.entities.PromoCode.create({ code: bundle.codexCreditUrl, codex_credit_url: bundle.codexCreditUrl, ...apiFields, assigned_email: "", assigned_at: "" });
        added += 1;
        continue;
      }
      const currentApi = promo.api_credit_code || promo.api_credit_url || "";
      if (currentApi && currentApi !== bundle.apiCreditValue) return errorResult(`Codex credit link already has a different API credit: ${bundle.codexCreditUrl}`);
      if (!currentApi || !promo.codex_credit_url) {
        await client.entities.PromoCode.update(promo.id, { codex_credit_url: bundle.codexCreditUrl, ...apiFields });
        completed += 1;
      }
    }
    return result({ rows: bundles.length, added, completed, unchanged: bundles.length - added - completed });
  });

  server.registerTool("build_week_reset_system", {
    title: "Reset event system", description: "Permanently delete all participants, teams, mentors, judges, judge groups, check-ins, promo pairs, and access history while preserving event content. This cannot be undone.",
    inputSchema: z.object({ confirmation: z.literal("DELETE ALL EVENT DATA") }).strict(), annotations: annotations.destructive,
  }, async () => {
    const deleted = await Promise.all([
      client.entities.AccessDeliveryAttempt.deleteMany({}),
      client.entities.Mentor.deleteMany({}), client.entities.Judge.deleteMany({}), client.entities.JudgeGroup.deleteMany({}),
      client.entities.Participant.deleteMany({}), client.entities.PromoCode.deleteMany({}), client.entities.TeamInfo.deleteMany({}),
    ]);
    return result({ reset: true, deleted: deleted.map((entry) => entry.deleted) });
  });
}

interface ParticipantSelector { participant_id: string; email: string }

const participantSelectorFields = { participant_id: z.string().max(200).default(""), email: z.string().max(320).default("") };

function hasParticipantSelector(value: { participant_id: string; email: string }) {
  return Boolean(value.participant_id || value.email);
}

function deliveryAttempt(attempt: Record<string, unknown>) {
  return {
    id: attempt.id, participant_id: attempt.participant_id, participant_email: attempt.participant_email,
    action: attempt.action, status: attempt.status, attempted_at: attempt.attempted_at,
    access_version: attempt.access_version, error_code: attempt.error_code || null, actor_email: attempt.actor_email,
  };
}

function redacted(value: string | null) {
  return value ? "[redacted]" : value;
}

const mailStatusLabels: Record<string, string> = { accepted: "sent", pending: "sending", failed: "failed", unknown: "unknown" };

type ExportDataset = "participants" | "mentors" | "teams" | "judges";

function serializeCustomFields(customFields: Record<string, string> | undefined) {
  return Object.entries(customFields ?? {}).map(([label, value]) => `${label}: ${value}`).join("; ");
}

function exportRows(dataset: ExportDataset, participants: ParticipantRecord[], mentors: Array<Record<string, unknown>>, promos: Array<Record<string, unknown>>, judges: Array<Record<string, unknown>>, judgeGroups: Array<Record<string, unknown>>, teamInfos: Array<Record<string, unknown>>) {
  if (dataset === "participants") {
    const assignedEmails = new Set(promos.filter((promo) => promo.assigned_email).map((promo) => String(promo.assigned_email).trim().toLocaleLowerCase()));
    return {
      headers: ["Name", "Email", "Phone", "LinkedIn", "Team", "Checked In", "Checked In At", "Mail Status", "Coupon", "Portal Opened At", "Promo Claimed At", "Custom Fields"],
      rows: participants.map((participant) => [
        participant.display_name,
        participant.email,
        participant.phone ?? "",
        participant.linkedin ?? "",
        participant.team_name,
        participant.checked_in === true ? "yes" : "no",
        participant.checked_in_at ?? "",
        mailStatusLabels[participant.access_email_status ?? ""] ?? "not sent",
        assignedEmails.has(participant.email.trim().toLocaleLowerCase()) ? "ready" : "not assigned",
        participant.portal_first_seen_at ?? "",
        participant.promo_claimed_at ?? "",
        serializeCustomFields(participant.custom_fields),
      ]),
    };
  }
  if (dataset === "mentors") {
    return {
      headers: ["Name", "Email", "Phone", "LinkedIn", "Details", "Teams", "Participants"],
      rows: mentors.map((mentor) => {
        const assigned = participants.filter((participant) => participant.mentor_key === mentor.mentor_key);
        const teamNames = [...new Set(assigned.map((participant) => participant.team_name || participant.team_key))].sort();
        return [
          String(mentor.display_name ?? ""), String(mentor.email ?? ""), String(mentor.phone ?? ""),
          String(mentor.linkedin ?? ""), String(mentor.details ?? ""), teamNames.join("; "), String(assigned.length),
        ];
      }),
    };
  }
  if (dataset === "judges") {
    const teamNameByKey = new Map(participants.map((participant) => [participant.team_key, participant.team_name]));
    return {
      headers: ["Name", "Email", "Phone", "LinkedIn", "Details", "Groups", "Teams"],
      rows: judges.map((judge) => {
        const memberOf = judgeGroups.filter((group) => stringArray(group.judge_keys).includes(String(judge.judge_key)));
        const teamNames = new Set(memberOf.flatMap((group) => stringArray(group.team_keys)).map((key) => teamNameByKey.get(key) ?? key));
        return [
          String(judge.display_name ?? ""), String(judge.email ?? ""), String(judge.phone ?? ""),
          String(judge.linkedin ?? ""), String(judge.details ?? ""),
          memberOf.map((group) => String(group.name ?? "")).sort().join("; "), [...teamNames].sort().join("; "),
        ];
      }),
    };
  }
  const mentorByKey = new Map(mentors.map((mentor) => [mentor.mentor_key, mentor.display_name]));
  const groupNameByTeamKey = new Map(judgeGroups.flatMap((group) => stringArray(group.team_keys).map((teamKey) => [teamKey, String(group.name ?? "")] as const)));
  const teamInfoByKey = new Map(teamInfos.map((info) => [String(info.team_key), info]));
  return {
    headers: ["Team", "Table", "Table Note", "Mentor", "Judge Group", "Members"],
    rows: summarizeTeams(participants, mentorByKey, teamInfoByKey).map((team) => [
      team.team_name,
      team.table_number,
      team.table_note,
      team.mentor_assignment.status === "assigned" ? String(team.mentor_assignment.mentor_name ?? team.mentor_assignment.mentor_key) : team.mentor_assignment.status === "mixed" ? "mixed" : "",
      groupNameByTeamKey.get(team.team_key) ?? "",
      team.members.map((member) => member.display_name).join(", "),
    ]),
  };
}
