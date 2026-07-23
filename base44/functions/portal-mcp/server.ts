import { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.29.0/server/webStandardStreamableHttp.js";
import { z } from "npm:zod@4.4.3";

import { loadPortalResponse } from "./portal-response.ts";
import { eventQuickLinks } from "./quick-links.ts";

// Every tool answers for the participant the bearer token resolved to. No tool
// accepts an identity argument, so one attendee cannot address another.
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const noInput = z.object({}).strict();

export function createPortalMcpServer(client: any, participant: any): McpServer {
  const server = new McpServer({ name: "build-week-event", version: "1.0.0" });
  const portal = () => loadPortalResponse({ asServiceRole: client }, participant);

  server.registerTool("event_my_status", {
    title: "My event status",
    description: "Who I am at this event: my name, team, table, check-in state, my mentor, and whether my credits are ready.",
    inputSchema: noInput, annotations: readOnly,
  }, async () => {
    const { participant: me, teamTable, teamMembers, mentor, promoLinks } = await portal();
    return result({
      display_name: me.displayName, email: me.email, team_name: me.teamName,
      table_number: teamTable?.tableNumber || null, table_note: teamTable?.note || null,
      checked_in: me.checkedIn, checked_in_at: me.checkedInAt,
      mentor_name: mentor?.displayName ?? null,
      team_size: teamMembers.length,
      checked_in_teammates: teamMembers.filter((member) => member.checkedIn).length,
      credits_ready: Boolean(promoLinks.codexCredits || promoLinks.apiCredits),
    });
  });

  server.registerTool("event_my_team", {
    title: "My team",
    description: "My team name, where our table is, and every teammate with their check-in state.",
    inputSchema: noInput, annotations: readOnly,
  }, async () => {
    const { participant: me, teamTable, teamMembers } = await portal();
    return result({ team_name: me.teamName, table_number: teamTable?.tableNumber || null, table_note: teamTable?.note || null, members: teamMembers });
  });

  server.registerTool("event_my_mentor", {
    title: "My mentor",
    description: "My assigned mentor and how to reach them: name, email, phone, LinkedIn, and where to find them.",
    inputSchema: noInput, annotations: readOnly,
  }, async () => {
    const { mentor } = await portal();
    if (!mentor) return result({ mentor: null, note: "No mentor is assigned to your team yet. Ask an organizer at the check-in desk." });
    return result({ mentor });
  });

  server.registerTool("event_my_credits", {
    title: "My Codex and API credits",
    description: "My personal Codex and API credit links plus the redemption instructions. Credits only exist after I check in at the door.",
    inputSchema: noInput, annotations: readOnly,
  }, async () => {
    const { participant: me, promoLinks, settings } = await portal();
    if (!me.checkedIn) return result({ available: false, reason: "Credits are issued when you check in at the door." });
    if (!promoLinks.codexCredits && !promoLinks.apiCredits) return result({ available: false, reason: "You are checked in but no credit pair is assigned yet. Ask an organizer." });
    return result({
      available: true,
      codex_credits: promoLinks.codexCredits,
      api_credits: promoLinks.apiCredits,
      instructions: settings?.promoInstructions ?? "",
    });
  });

  server.registerTool("event_logistics", {
    title: "Venue, Wi-Fi, and event details",
    description: "Wi-Fi networks and passwords, the venue and event description, and the event page.",
    inputSchema: noInput, annotations: readOnly,
  }, async () => {
    const { settings } = await portal();
    if (!settings) return result({ published: false });
    return result({
      published: true,
      event_name: settings.eventName,
      event_url: settings.eventUrl,
      event_details: settings.eventDetails,
      wifi: [
        { network: settings.wifiNetwork, password: settings.wifiPassword },
        { network: settings.wifiNetworkSecondary, password: settings.wifiPasswordSecondary },
      ].filter(({ network }) => network),
    });
  });

  server.registerTool("event_agenda", {
    title: "Run of show",
    description: "The event agenda in order, including doors, kickoff, judging, and demos.",
    inputSchema: noInput, annotations: readOnly,
  }, async () => {
    const { settings } = await portal();
    const agenda: string = settings?.agenda ?? "";
    return result({ agenda: agenda.split("\n").map((line: string) => line.trim()).filter(Boolean) });
  });

  server.registerTool("event_answers", {
    title: "Event questions and answers",
    description: "The organizers' answers to common event questions. Read this before guessing about anything event-specific.",
    inputSchema: noInput, annotations: readOnly,
  }, async () => {
    const { settings } = await portal();
    return result({ answers: parseAnswers(settings?.questionsAndAnswers ?? "") });
  });

  server.registerTool("event_resources", {
    title: "Event quick links",
    description: "Links the organizers published: slides, the WhatsApp group, and tooling shortcuts.",
    inputSchema: noInput, annotations: readOnly,
  }, async () => result({ links: eventQuickLinks }));

  return server;
}

export async function handlePortalMcpProtocolRequest(client: any, participant: any, request: Request): Promise<Response> {
  const server = createPortalMcpServer(client, participant);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

function result(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function parseAnswers(value: string): Array<{ question: string; answer: string }> {
  try {
    const parsed = JSON.parse(value) as Array<{ question?: unknown; answer?: unknown }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => typeof entry?.question === "string" && typeof entry?.answer === "string")
      .map((entry) => ({ question: String(entry.question).trim(), answer: String(entry.answer).trim() }))
      .filter(({ question, answer }) => question && answer);
  } catch {
    return [];
  }
}
