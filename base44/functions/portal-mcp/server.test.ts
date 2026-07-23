import { assertEquals, assertRejects } from "jsr:@std/assert@1";

import { signAccessToken } from "../access-admin/access-link.ts";
import { bearerToken, participantFromAccessToken } from "./participant.ts";
import { handlePortalMcpProtocolRequest } from "./server.ts";

const secret = "a-strong-function-bundle-secret-value";
const expiresAt = "2026-08-01T21:00:00.000Z";

Deno.test("event MCP exposes only read-only tools that take no identity argument", async () => {
  const response = await mcpRequest(fakeClient(), participants[0], "tools/list", {}, 1);
  const tools = response.result.tools as Array<{ name: string; annotations: { readOnlyHint: boolean }; inputSchema: { properties?: Record<string, unknown> } }>;

  assertEquals(tools.length, 8);
  assertEquals(tools.every((tool) => tool.annotations.readOnlyHint === true), true);
  assertEquals(tools.every((tool) => Object.keys(tool.inputSchema.properties ?? {}).length === 0), true);
});

Deno.test("event MCP answers for the token holder and never leaks another participant", async () => {
  const status = await mcpRequest(fakeClient(), participants[0], "tools/call", { name: "event_my_status", arguments: {} }, 2);
  assertEquals(status.result.structuredContent.display_name, "Ada");
  assertEquals(status.result.structuredContent.mentor_name, "Grace");
  assertEquals(status.result.structuredContent.checked_in_teammates, 1);

  const team = await mcpRequest(fakeClient(), participants[0], "tools/call", { name: "event_my_team", arguments: {} }, 3);
  assertEquals(team.result.structuredContent.table_number, "12");
  assertEquals(team.result.structuredContent.table_note, "Floor 2 near the fridge");
  const members = team.result.structuredContent.members as Array<Record<string, unknown>>;
  assertEquals(members.map((member) => member.displayName), ["Ada", "Alan"]);
  assertEquals(members.some((member) => "email" in member), false);
});

Deno.test("event MCP hides credits until the participant is checked in", async () => {
  const beforeCheckIn = await mcpRequest(fakeClient(), participants[1], "tools/call", { name: "event_my_credits", arguments: {} }, 4);
  assertEquals(beforeCheckIn.result.structuredContent.available, false);
  assertEquals(JSON.stringify(beforeCheckIn.result.structuredContent).includes("codex-two"), false);

  const afterCheckIn = await mcpRequest(fakeClient(), participants[0], "tools/call", { name: "event_my_credits", arguments: {} }, 5);
  assertEquals(afterCheckIn.result.structuredContent.available, true);
  assertEquals(afterCheckIn.result.structuredContent.codex_credits, "codex-two");
});

Deno.test("event MCP returns the published event content", async () => {
  const logistics = await mcpRequest(fakeClient(), participants[0], "tools/call", { name: "event_logistics", arguments: {} }, 6);
  assertEquals(logistics.result.structuredContent.wifi, [{ network: "EventGuest", password: "example-password" }]);

  const agenda = await mcpRequest(fakeClient(), participants[0], "tools/call", { name: "event_agenda", arguments: {} }, 7);
  assertEquals(agenda.result.structuredContent.agenda, ["START", "17:00 — Doors"]);

  const answers = await mcpRequest(fakeClient(), participants[0], "tools/call", { name: "event_answers", arguments: {} }, 8);
  assertEquals(answers.result.structuredContent.answers, [{ question: "When do credits appear?", answer: "After check-in." }]);

  const resources = await mcpRequest(fakeClient(), participants[0], "tools/call", { name: "event_resources", arguments: {} }, 9);
  assertEquals((resources.result.structuredContent.links as unknown[]).length > 0, true);
});

Deno.test("event MCP resolves the participant from a signed key and rejects tampered, rotated, and expired keys", async () => {
  const client = fakeClient();
  const token = await signAccessToken({ accessKey: "ada-access-key-0001", version: 1, expiresAt }, secret);
  assertEquals(bearerToken(new Request("https://example.com", { headers: { Authorization: `Bearer ${token}` } })), token);
  assertEquals((await participantFromAccessToken(client, token, secret)).display_name, "Ada");

  const otherSecret = "another-strong-function-bundle-secret";
  await assertRejects(() => participantFromAccessToken(client, token, otherSecret));

  const rotated = await signAccessToken({ accessKey: "ada-access-key-0001", version: 2, expiresAt }, secret);
  await assertRejects(() => participantFromAccessToken(client, rotated, secret));

  const expired = await signAccessToken({ accessKey: "ada-access-key-0001", version: 1, expiresAt: "2020-01-01T00:00:00.000Z" }, secret);
  await assertRejects(() => participantFromAccessToken(client, expired, secret));

  const disabled = await signAccessToken({ accessKey: "alan-access-key-0002", version: 1, expiresAt }, secret);
  await assertRejects(() => participantFromAccessToken(fakeClient({ disableAlan: true }), disabled, secret));
});

const participants = [
  { id: "p1", email: "ada@example.com", display_name: "Ada", team_key: "compiler", team_name: "Compiler Crew", mentor_key: "grace", checked_in: true, checked_in_at: "2026-08-01T14:00:00.000Z", active: true, access_key: "ada-access-key-0001", access_version: 1, access_enabled: true },
  { id: "p2", email: "alan@example.com", display_name: "Alan", team_key: "compiler", team_name: "Compiler Crew", mentor_key: "grace", checked_in: false, active: true, access_key: "alan-access-key-0002", access_version: 1, access_enabled: true },
];

async function mcpRequest(client: ReturnType<typeof fakeClient>, participant: Record<string, unknown>, method: string, params: Record<string, unknown>, id: number) {
  const request = new Request("https://example.base44.app/functions/portal-mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
  });
  const response = await handlePortalMcpProtocolRequest(client, participant, request);
  assertEquals(response.status, 200);
  return await response.json();
}

function fakeClient({ disableAlan = false } = {}) {
  const rows = {
    Participant: participants.map((participant) => participant.id === "p2" && disableAlan ? { ...participant, access_enabled: false } : participant),
    TeamInfo: [{ id: "t1", team_key: "compiler", table_number: "12", note: "Floor 2 near the fridge" }],
    Mentor: [{ id: "m1", mentor_key: "grace", display_name: "Grace", email: "grace@example.com", phone: "+1 555 0100", details: "By the stage", linkedin: "" }],
    PromoCode: [{ id: "c2", code: "codex-two", codex_credit_url: "codex-two", api_credit_code: "api-two", assigned_email: "ada@example.com" }],
    EventSettings: [{
      id: "s1", event_name: "Codex Hackathon", event_url: "https://luma.com/example", wifi_network: "EventGuest", wifi_password: "example-password",
      wifi_network_secondary: "", wifi_password_secondary: "", event_details: "Build something", agenda: "START\n17:00 — Doors\n",
      questions_and_answers: JSON.stringify([{ question: "When do credits appear?", answer: "After check-in." }]), promo_instructions: "Sign in first",
    }],
  } as Record<string, Array<Record<string, unknown>>>;
  const entity = (name: string) => ({
    list: async () => rows[name]!,
    filter: async (criteria: Record<string, unknown> = {}) => rows[name]!.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value)),
  });
  return { entities: { Participant: entity("Participant"), TeamInfo: entity("TeamInfo"), Mentor: entity("Mentor"), PromoCode: entity("PromoCode"), EventSettings: entity("EventSettings") } };
}
