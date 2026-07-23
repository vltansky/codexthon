import { assertEquals, assertRejects } from "jsr:@std/assert@1";

import { addException, reassignPromo } from "./add-exception.ts";
import { findAvailablePromo } from "./eligibility.ts";

Deno.test("skips blocked promo rows when selecting an assignment", () => {
  const blocked = { id: "promo-1", code: "codex-1", api_credit_code: "api-1", blocked: true };
  const available = { id: "promo-2", code: "codex-2", api_credit_code: "api-2" };

  assertEquals(findAvailablePromo([blocked, available]), available);
});

Deno.test("reassign retires the current pair and claims a fresh available one", async () => {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const current = { id: "promo-1", code: "codex-1", api_credit_code: "api-1", assigned_email: "ada@example.com" };
  const fresh = { id: "promo-2", code: "codex-2", api_credit_code: "api-2", assigned_email: "" };
  const base44 = {
    asServiceRole: {
      entities: {
        PromoCode: {
          filter: async (query: Record<string, unknown>) => query.assigned_email === "" ? [fresh] : [current],
          update: async (id: string, data: Record<string, unknown>) => {
            updates.push({ id, data });
            return null;
          },
        },
      },
    },
  };

  const assigned = await reassignPromo(base44, "ada@example.com");

  assertEquals(assigned.id, "promo-2");
  assertEquals(assigned.assigned_email, "ada@example.com");
  assertEquals(updates[0].id, "promo-1");
  assertEquals(updates[0].data, { assigned_email: "", assigned_at: "", blocked: true });
  assertEquals(updates[1].id, "promo-2");
  assertEquals(updates[1].data.assigned_email, "ada@example.com");
});

Deno.test("reassign keeps the current pair when no fresh pair is available", async () => {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const current = { id: "promo-1", code: "codex-1", api_credit_code: "api-1", assigned_email: "ada@example.com" };
  const base44 = {
    asServiceRole: {
      entities: {
        PromoCode: {
          filter: async (query: Record<string, unknown>) => query.assigned_email === "" ? [] : [current],
          update: async (id: string, data: Record<string, unknown>) => {
            updates.push({ id, data });
            return null;
          },
        },
      },
    },
  };

  await assertRejects(() => reassignPromo(base44, "ada@example.com"), Error, "No complete promo pairs available");
  assertEquals(updates, []);
});

Deno.test("reassign excludes the participant's current pair from the fresh pool", async () => {
  const current = { id: "promo-1", code: "codex-1", api_credit_code: "api-1", assigned_email: "ada@example.com" };
  const base44 = {
    asServiceRole: {
      entities: {
        PromoCode: {
          filter: async (query: Record<string, unknown>) => query.assigned_email === "" ? [current] : [current],
          update: async () => null,
        },
      },
    },
  };

  await assertRejects(() => reassignPromo(base44, "ada@example.com"), Error, "No complete promo pairs available");
});

Deno.test("adds an exception to an existing team when no promo pairs are available", async () => {
  const createdParticipants: Array<Record<string, unknown>> = [];
  const existingTeamMember = {
    id: "participant-1",
    email: "ada@example.com",
    team_key: "compiler-crew",
    team_name: "Compiler Crew",
    mentor_key: "grace",
    active: true,
  };
  const base44 = {
    asServiceRole: {
      entities: {
        Participant: {
          filter: async (query: Record<string, unknown>) => query.team_key ? [existingTeamMember] : [],
          create: async (data: Record<string, unknown>) => {
            createdParticipants.push(data);
            return { id: "participant-2", ...data };
          },
          update: async () => null,
        },
        PromoCode: {
          filter: async () => [],
          update: async () => null,
        },
      },
    },
  };

  const response = await addException(base44, {
    displayName: "New Member",
    email: "new-member@example.com",
    teamKey: "compiler-crew",
    assignPromo: true,
  });

  assertEquals(response.status, 200);
  assertEquals(createdParticipants.length, 1);
  assertEquals(await response.json(), {
    participantId: "participant-2",
    displayName: "New Member",
    teamName: "Compiler Crew",
    createdTeam: false,
    promoLinks: null,
  });
});
