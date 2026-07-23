import { assertEquals } from "jsr:@std/assert@1";

import { hasValidBearerToken } from "./auth.ts";
import { handleAdminMcpProtocolRequest } from "./server.ts";

Deno.test("admin MCP rejects missing and incorrect bearer tokens", async () => {
  assertEquals(await hasValidBearerToken(new Request("https://example.com"), "correct-token"), false);
  assertEquals(await hasValidBearerToken(new Request("https://example.com", { headers: { Authorization: "Bearer incorrect-token" } }), "correct-token"), false);
  assertEquals(await hasValidBearerToken(new Request("https://example.com", { headers: { Authorization: "Bearer correct-token" } }), "correct-token"), true);
});

Deno.test("admin MCP exposes the full tool catalog and returns redacted operational status", async () => {
  const client = fakeAdminClient();
  const toolsResponse = await mcpRequest(client, "tools/list", {}, 1);
  assertEquals(toolsResponse.result.tools.length, 40);
  assertEquals(toolsResponse.result.tools.some((tool: { name: string }) => tool.name === "build_week_reset_system"), true);

  const statusResponse = await mcpRequest(client, "tools/call", { name: "build_week_get_status", arguments: {} }, 2);
  assertEquals(statusResponse.result.structuredContent, {
    participants: 2,
    teams: 1,
    mentors: 1,
    judges: 1,
    judge_groups: 2,
    checked_in: 1,
    portal_opened: 0,
    promos_claimed: 0,
    codex_credits_available: 1,
    api_credits_available: 1,
    promo_assignments: 1,
    promo_credits_blocked: 0,
    access_emails_pending: 0,
    access_emails_accepted: 1,
  });
});

Deno.test("admin MCP reset preserves event content", async () => {
  const client = fakeAdminClient();
  const response = await mcpRequest(client, "tools/call", {
    name: "build_week_reset_system",
    arguments: { confirmation: "DELETE ALL EVENT DATA" },
  }, 3);

  assertEquals(response.result.structuredContent.reset, true);
  assertEquals(client.deletedEntities.has("EventSettings"), false);
  assertEquals(client.deletedEntities.has("Participant"), true);
  assertEquals(client.deletedEntities.has("Judge"), true);
  assertEquals(client.deletedEntities.has("JudgeGroup"), true);
});

Deno.test("admin MCP manages the judge directory and strips deleted judges from panels", async () => {
  const client = fakeAdminClient();
  const listResponse = await mcpRequest(client, "tools/call", { name: "build_week_list_judges", arguments: {} }, 20);
  assertEquals(listResponse.result.structuredContent.items, [{ id: "j1", judge_key: "andrej", display_name: "Andrej", group_count: 1, team_count: 1 }]);

  const added = await mcpRequest(client, "tools/call", {
    name: "build_week_add_judge",
    arguments: { display_name: "Lex Fridman", email: "LEX@Example.com" },
  }, 21);
  assertEquals(added.result.structuredContent.judge.judge_key, "lex@example.com");
  assertEquals(added.result.structuredContent.judge.email, "lex@example.com");

  const duplicate = await mcpRequest(client, "tools/call", {
    name: "build_week_add_judge",
    arguments: { display_name: "Andrej" },
  }, 22);
  assertEquals(duplicate.result.isError, true);

  const deleted = await mcpRequest(client, "tools/call", {
    name: "build_week_delete_judge",
    arguments: { judge_id: "j1", confirm: "DELETE JUDGE" },
  }, 23);
  assertEquals(deleted.result.structuredContent.cleared_judge_groups, 1);
  assertEquals(client.updates.get("JudgeGroup"), [{ id: "g1", data: { judge_keys: [] } }]);
});

Deno.test("admin MCP creates and updates judge groups with validated members", async () => {
  const client = fakeAdminClient();
  const created = await mcpRequest(client, "tools/call", {
    name: "build_week_create_judge_group",
    arguments: { name: "Room C", mentor_keys: ["grace"], judge_keys: ["andrej"] },
  }, 30);
  assertEquals(created.result.structuredContent.group.group_key, "room-c");

  const duplicate = await mcpRequest(client, "tools/call", {
    name: "build_week_create_judge_group",
    arguments: { name: "Room A" },
  }, 31);
  assertEquals(duplicate.result.isError, true);

  const unknownMember = await mcpRequest(client, "tools/call", {
    name: "build_week_create_judge_group",
    arguments: { name: "Room D", judge_keys: ["nobody"] },
  }, 32);
  assertEquals(unknownMember.result.isError, true);

  await mcpRequest(client, "tools/call", {
    name: "build_week_update_judge_group",
    arguments: { group_id: "g2", name: "Room B Finals", details: "Wild cards", mentor_keys: ["grace"], judge_keys: [] },
  }, 33);
  assertEquals(client.updates.get("JudgeGroup"), [{ id: "g2", data: { name: "Room B Finals", details: "Wild cards", mentor_keys: ["grace"], judge_keys: [] } }]);
});

Deno.test("admin MCP assigns each team to at most one judge group", async () => {
  const client = fakeAdminClient();
  const assigned = await mcpRequest(client, "tools/call", {
    name: "build_week_assign_teams_to_judge_group",
    arguments: { group_id: "g2", team_keys: ["compiler"] },
  }, 40);
  assertEquals(assigned.result.structuredContent.removed_from_groups, 1);
  assertEquals(client.updates.get("JudgeGroup"), [
    { id: "g1", data: { team_keys: [] } },
    { id: "g2", data: { team_keys: ["compiler"] } },
  ]);

  const unknownTeam = await mcpRequest(client, "tools/call", {
    name: "build_week_assign_teams_to_judge_group",
    arguments: { group_id: "g2", team_keys: ["ghost-team"] },
  }, 41);
  assertEquals(unknownTeam.result.isError, true);
});

Deno.test("admin MCP lists judge groups with resolved member and team names", async () => {
  const client = fakeAdminClient();
  const response = await mcpRequest(client, "tools/call", { name: "build_week_list_judge_groups", arguments: {} }, 50);
  assertEquals(response.result.structuredContent.items[0], {
    id: "g1",
    group_key: "room-a",
    name: "Room A",
    details: "",
    mentors: [{ key: "grace", display_name: "Grace" }],
    judges: [{ key: "andrej", display_name: "Andrej" }],
    teams: [{ team_key: "compiler", team_name: "Compiler" }],
  });
});

Deno.test("admin MCP deleting a mentor also strips them from judge groups", async () => {
  const client = fakeAdminClient();
  await mcpRequest(client, "tools/call", {
    name: "build_week_delete_mentor",
    arguments: { mentor_id: "m1", confirm: "DELETE MENTOR" },
  }, 60);
  assertEquals(client.updates.get("JudgeGroup"), [{ id: "g1", data: { mentor_keys: [] } }]);
});

Deno.test("admin MCP exports judges as CSV with their panels", async () => {
  const client = fakeAdminClient();
  const response = await mcpRequest(client, "tools/call", {
    name: "build_week_export_csv",
    arguments: { dataset: "judges" },
  }, 70);
  assertEquals(response.result.structuredContent.csv.split("\r\n"), [
    "Name,Email,Phone,LinkedIn,Details,Groups,Teams",
    "Andrej,,,,,Room A,Compiler",
  ]);
});

Deno.test("admin MCP participant detail hides the access key and reports assigned promo state", async () => {
  const client = fakeAdminClient();
  const response = await mcpRequest(client, "tools/call", {
    name: "build_week_get_participant",
    arguments: { email: "ada@example.com" },
  }, 4);

  const detail = response.result.structuredContent;
  assertEquals(detail.participant.access_key, undefined);
  assertEquals(detail.has_access_key, true);
  assertEquals(detail.selected_photo_count, 2);
  assertEquals(detail.mentor.display_name, "Grace");
  assertEquals(detail.team_members.length, 2);
  assertEquals(detail.promo, { id: "c2", status: "assigned", assigned_at: null });
  assertEquals(detail.access_deliveries.length, 1);
});

Deno.test("admin MCP portal preview redacts credentials unless they are requested", async () => {
  const client = fakeAdminClient();
  const redactedResponse = await mcpRequest(client, "tools/call", {
    name: "build_week_preview_participant_portal",
    arguments: { email: "ada@example.com" },
  }, 5);
  const redactedPortal = redactedResponse.result.structuredContent.portal;
  assertEquals(redactedPortal.participant.displayName, "Ada");
  assertEquals(redactedPortal.settings.wifiPassword, "[redacted]");
  assertEquals(redactedPortal.promoLinks, { codexCredits: "[redacted]", apiCredits: "[redacted]" });

  const fullResponse = await mcpRequest(client, "tools/call", {
    name: "build_week_preview_participant_portal",
    arguments: { email: "ada@example.com", include_credentials: true },
  }, 6);
  const fullPortal = fullResponse.result.structuredContent.portal;
  assertEquals(fullPortal.settings.wifiPassword, "hunter2");
  assertEquals(fullPortal.promoLinks, { codexCredits: "codex-two", apiCredits: "api-two" });
});

Deno.test("admin MCP blocks unassigned promo credits and refuses assigned ones", async () => {
  const client = fakeAdminClient();
  const blocked = await mcpRequest(client, "tools/call", {
    name: "build_week_set_promo_blocked",
    arguments: { promo_id: "c1", blocked: true },
  }, 7);
  assertEquals(blocked.result.structuredContent.promo, { id: "c1", status: "blocked" });
  assertEquals(client.updates.get("PromoCode"), [{ id: "c1", data: { blocked: true } }]);

  const refused = await mcpRequest(client, "tools/call", {
    name: "build_week_set_promo_blocked",
    arguments: { promo_id: "c2", blocked: true },
  }, 8);
  assertEquals(refused.result.isError, true);
  assertEquals(client.updates.get("PromoCode")?.length, 1);
});

Deno.test("admin MCP checks many participants in or out in one call", async () => {
  const client = fakeAdminClient();
  await mcpRequest(client, "tools/call", {
    name: "build_week_set_check_in",
    arguments: { updates: [{ email: "ada@example.com", checked_in: false }, { email: "alan@example.com", checked_in: true }] },
  }, 9);

  assertEquals(client.invocations, [["check-in-participants", {
    updates: [{ email: "ada@example.com", checkedIn: false }, { email: "alan@example.com", checkedIn: true }],
  }]]);
});

Deno.test("admin MCP updates participant profile fields without exposing the access key", async () => {
  const client = fakeAdminClient();
  const response = await mcpRequest(client, "tools/call", {
    name: "build_week_update_participant",
    arguments: { email: "alan@example.com", phone: "+972-50-000-0105", linkedin: "https://www.linkedin.com/in/alan/", custom_fields: { GitHub: "https://github.com/alan" } },
  }, 90);
  const updated = response.result.structuredContent.participant;
  assertEquals(updated.phone, "+972-50-000-0105");
  assertEquals(updated.access_key, undefined);
  assertEquals(client.updates.get("Participant"), [{
    id: "p2",
    data: { phone: "+972-50-000-0105", linkedin: "https://www.linkedin.com/in/alan/", custom_fields: { GitHub: "https://github.com/alan" } },
  }]);

  const missingFields = await mcpRequest(client, "tools/call", {
    name: "build_week_update_participant",
    arguments: { email: "alan@example.com" },
  }, 91);
  assertEquals(missingFields.result.isError, true);
});

Deno.test("admin MCP changes a participant email through the check-in function", async () => {
  const client = fakeAdminClient();
  await mcpRequest(client, "tools/call", {
    name: "build_week_change_participant_email",
    arguments: { participant_id: "p1", email: "ada@newdomain.com" },
  }, 10);

  assertEquals(client.invocations, [["check-in-participants", { action: "update-email", participantId: "p1", email: "ada@newdomain.com" }]]);
});

Deno.test("admin MCP exports rosters as CSV without credentials", async () => {
  const client = fakeAdminClient();
  const participantsResponse = await mcpRequest(client, "tools/call", {
    name: "build_week_export_csv",
    arguments: { dataset: "participants" },
  }, 11);
  const participantsExport = participantsResponse.result.structuredContent;
  assertEquals(participantsExport.row_count, 2);
  assertEquals(participantsExport.csv.split("\r\n"), [
    "Name,Email,Phone,LinkedIn,Team,Checked In,Checked In At,Mail Status,Coupon,Portal Opened At,Promo Claimed At,Custom Fields",
    "Ada,ada@example.com,+972-50-000-0104,https://www.linkedin.com/in/ada/,Compiler,yes,,sent,ready,,,GitHub: https://github.com/ada",
    "Alan,alan@example.com,,,Compiler,no,,not sent,not assigned,,,",
  ]);
  assertEquals(participantsExport.csv.includes("secret"), false);
  assertEquals(participantsExport.csv.includes("codex-two"), false);

  const teamsResponse = await mcpRequest(client, "tools/call", {
    name: "build_week_export_csv",
    arguments: { dataset: "teams" },
  }, 12);
  assertEquals(teamsResponse.result.structuredContent.csv.split("\r\n"), [
    "Team,Table,Table Note,Mentor,Judge Group,Members",
    'Compiler,12,Floor 2 near the fridge,Grace,Room A,"Ada, Alan"',
  ]);
});

Deno.test("admin MCP sets a team table and refuses unknown teams", async () => {
  const client = fakeAdminClient();
  const updated = await mcpRequest(client, "tools/call", {
    name: "build_week_set_team_table",
    arguments: { team_key: "compiler", table_number: "7", note: "Floor 1 by the stage" },
  }, 13);
  assertEquals(updated.result.structuredContent, { team_key: "compiler", table_number: "7", note: "Floor 1 by the stage" });
  assertEquals(client.updates.get("TeamInfo"), [{ id: "t1", data: { table_number: "7", note: "Floor 1 by the stage" } }]);

  const unknownTeam = await mcpRequest(client, "tools/call", {
    name: "build_week_set_team_table",
    arguments: { team_key: "ghost-team", table_number: "9" },
  }, 14);
  assertEquals(unknownTeam.result.isError, true);
});

async function mcpRequest(client: ReturnType<typeof fakeAdminClient>, method: string, params: Record<string, unknown>, id: number) {
  const request = new Request("https://example.base44.app/functions/admin-mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
  });
  const response = await handleAdminMcpProtocolRequest(client as unknown as Parameters<typeof handleAdminMcpProtocolRequest>[0], request);
  assertEquals(response.status, 200);
  return await response.json();
}

function fakeAdminClient() {
  const deletedEntities = new Set<string>();
  const updates = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();
  const invocations: Array<[string, Record<string, unknown>]> = [];
  const participants = [
    { id: "p1", email: "ada@example.com", display_name: "Ada", team_key: "compiler", team_name: "Compiler", mentor_key: "grace", checked_in: true, active: true, access_email_status: "accepted", access_key: "secret", selected_photo_ids: ["photo-1", "photo-2"], phone: "+972-50-000-0104", linkedin: "https://www.linkedin.com/in/ada/", custom_fields: { GitHub: "https://github.com/ada" } },
    { id: "p2", email: "alan@example.com", display_name: "Alan", team_key: "compiler", team_name: "Compiler", mentor_key: "grace", checked_in: false, active: true, access_email_status: "unsent", access_key: "secret" },
  ];
  const mentors = [{ id: "m1", mentor_key: "grace", display_name: "Grace" }];
  const judges = [{ id: "j1", judge_key: "andrej", display_name: "Andrej" }];
  const judgeGroups = [
    { id: "g1", group_key: "room-a", name: "Room A", mentor_keys: ["grace"], judge_keys: ["andrej"], team_keys: ["compiler"] },
    { id: "g2", group_key: "room-b", name: "Room B", mentor_keys: [], judge_keys: [], team_keys: [] },
  ];
  const promos = [
    { id: "c1", code: "codex-one", api_credit_code: "api-one", assigned_email: "" },
    { id: "c2", code: "codex-two", api_credit_code: "api-two", assigned_email: "ada@example.com" },
  ];
  const teamInfos = [{ id: "t1", team_key: "compiler", table_number: "12", note: "Floor 2 near the fridge" }];
  const settings = [{ id: "s1", event_name: "Build Week", wifi_password: "hunter2", wifi_password_secondary: "" }];
  const deliveries = [{ id: "d1", participant_id: "p1", participant_email: "ada@example.com", access_version: 1, action: "send", status: "accepted", attempted_at: "2026-07-20T09:00:00.000Z", actor_email: "admin@example.com" }];
  const entity = (name: string, rows: Array<Record<string, unknown>>) => ({
    list: async () => rows,
    filter: async (criteria: Record<string, unknown> = {}) => rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value)),
    get: async (id: string) => rows.find((row) => row.id === id),
    create: async (data: Record<string, unknown>) => ({ id: crypto.randomUUID(), ...data }),
    update: async (id: string, data: Record<string, unknown>) => {
      updates.set(name, [...(updates.get(name) ?? []), { id, data }]);
      return { id, ...data };
    },
    delete: async () => ({ success: true }),
    deleteMany: async () => {
      deletedEntities.add(name);
      return { deleted: rows.length };
    },
    bulkCreate: async (items: Array<Record<string, unknown>>) => items,
  });
  return {
    entities: {
      Participant: entity("Participant", participants), Mentor: entity("Mentor", mentors), PromoCode: entity("PromoCode", promos),
      EventSettings: entity("EventSettings", settings), AccessDeliveryAttempt: entity("AccessDeliveryAttempt", deliveries), Guest: entity("Guest", []),
      Judge: entity("Judge", judges), JudgeGroup: entity("JudgeGroup", judgeGroups), TeamInfo: entity("TeamInfo", teamInfos),
    },
    functions: {
      invoke: async (name: string, data: Record<string, unknown>) => {
        invocations.push([name, data]);
        return { data: {} };
      },
    },
    deletedEntities,
    updates,
    invocations,
  };
}
