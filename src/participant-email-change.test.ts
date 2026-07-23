import assert from "node:assert/strict";
import test from "node:test";

const backendModuleUrl = new URL("../base44/functions/check-in-participants/participant-email-change.ts", import.meta.url).href;
const { changeParticipantEmail } = await import(backendModuleUrl) as {
  changeParticipantEmail(base44: any, participantId: string, requestedEmail: string): Promise<{
    participantId: string;
    previousEmail: string;
    email: string;
  }>;
};

function createClient(participant: Record<string, unknown>, options: {
  matches?: Array<Record<string, unknown>>;
  promos?: Array<Record<string, unknown>>;
  participantUpdate?: () => Promise<Record<string, unknown>>;
  onPromoUpdate?: (data: Record<string, unknown>) => void;
} = {}) {
  return {
    asServiceRole: {
      entities: {
        Participant: {
          get: async () => participant,
          filter: async () => options.matches ?? [],
          update: options.participantUpdate ?? (async (_id: string, data: Record<string, unknown>) => ({ ...participant, ...data })),
        },
        PromoCode: {
          filter: async () => options.promos ?? [],
          update: async (_id: string, data: Record<string, unknown>) => {
            options.onPromoUpdate?.(data);
            return data;
          },
        },
      },
    },
  };
}

test("changes the participant email and moves assigned promos without changing access state", async () => {
  const participant = {
    id: "participant-1",
    email: "old@example.com",
    active: true,
    checked_in: true,
    access_key: "access-key",
    access_version: 3,
    access_email_status: "accepted",
    access_email_accepted_at: "2026-07-20T12:00:00.000Z",
  };
  const promo = { id: "promo-1", assigned_email: "old@example.com" };
  const participantUpdates: Array<Record<string, unknown>> = [];
  const promoUpdates: Array<Record<string, unknown>> = [];
  const base44 = {
    asServiceRole: {
      entities: {
        Participant: {
          get: async () => participant,
          filter: async () => [],
          update: async (_id: string, data: Record<string, unknown>) => {
            participantUpdates.push(data);
            Object.assign(participant, data);
            return participant;
          },
        },
        PromoCode: {
          filter: async () => [promo],
          update: async (_id: string, data: Record<string, unknown>) => {
            promoUpdates.push(data);
            Object.assign(promo, data);
            return promo;
          },
        },
      },
    },
  };

  const result = await changeParticipantEmail(base44, "participant-1", " New@Example.COM ");

  assert.deepEqual(result, { participantId: "participant-1", previousEmail: "old@example.com", email: "new@example.com" });
  assert.deepEqual(promoUpdates, [{ assigned_email: "new@example.com" }]);
  assert.deepEqual(participantUpdates, [{
    email: "new@example.com",
    access_email_status: "unsent",
    access_email_pending_at: "",
    access_email_accepted_at: "",
  }]);
  assert.equal(participant.access_key, "access-key");
  assert.equal(participant.access_version, 3);
  assert.equal(participant.checked_in, true);
});

test("rejects invalid or duplicate email addresses before changing records", async () => {
  const participant = { id: "participant-1", email: "old@example.com", active: true };

  await assert.rejects(changeParticipantEmail(createClient(participant), "participant-1", "not-an-email"), {
    message: "Enter a valid email address",
    status: 400,
  });
  await assert.rejects(changeParticipantEmail(createClient(participant, {
    matches: [{ id: "participant-2", email: "new@example.com" }],
  }), "participant-1", "new@example.com"), {
    message: "A participant with this email already exists",
    status: 409,
  });
});

test("rejects an email change while access email delivery is active", async () => {
  const participant = {
    id: "participant-1",
    email: "old@example.com",
    active: true,
    access_email_status: "pending",
    access_email_pending_at: "2999-01-01T00:00:00.000Z",
  };

  await assert.rejects(changeParticipantEmail(createClient(participant), "participant-1", "new@example.com"), {
    message: "Access email delivery is in progress",
    status: 409,
  });
});

test("restores promo ownership when the participant update fails", async () => {
  const promoUpdates: Array<Record<string, unknown>> = [];
  const participant = { id: "participant-1", email: "old@example.com", active: true };
  const client = createClient(participant, {
    promos: [{ id: "promo-1", assigned_email: "old@example.com" }],
    participantUpdate: async () => { throw new Error("participant update failed"); },
    onPromoUpdate: (data) => promoUpdates.push(data),
  });

  await assert.rejects(changeParticipantEmail(client, "participant-1", "new@example.com"), /participant update failed/);
  assert.deepEqual(promoUpdates, [
    { assigned_email: "new@example.com" },
    { assigned_email: "old@example.com" },
  ]);
});
