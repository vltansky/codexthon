import assert from "node:assert/strict";
import test from "node:test";

interface DeliveryParticipant {
  id: string;
  active?: boolean;
  checked_in?: boolean;
  access_enabled?: boolean;
  access_email_status?: string;
  access_email_pending_at?: string;
}

const backendDeliveryModuleUrl = new URL("../base44/functions/access-admin/delivery.ts", import.meta.url).href;
const {
  createDeliveryAttemptKey,
  selectDeliveryRecipients,
  skippedDeliveryResult,
  deliveryConfirmationError,
} = await import(backendDeliveryModuleUrl) as {
  createDeliveryAttemptKey(accessKey: string, accessVersion: number, mode: "send" | "retry" | "resend", requestId: string): string;
  selectDeliveryRecipients<T extends DeliveryParticipant>(participants: readonly T[], input: { mode: "selected" | "all_unsent" | "resend"; participantIds: string[] }, limit: number): T[];
  skippedDeliveryResult(participantId: string, participant: DeliveryParticipant | undefined): { participantId: string; status: string; error: string };
  deliveryConfirmationError(participant: DeliveryParticipant): string | null;
};

const participants = [
  { id: "unsent", active: true, checked_in: true, access_enabled: true, access_email_status: "unsent" },
  { id: "failed", active: true, checked_in: true, access_enabled: true, access_email_status: "failed" },
  { id: "accepted", active: true, checked_in: true, access_enabled: true, access_email_status: "accepted" },
  { id: "pending", active: true, checked_in: true, access_enabled: true, access_email_status: "pending", access_email_pending_at: "2999-01-01T00:00:00.000Z" },
  { id: "stale-pending", active: true, checked_in: true, access_enabled: true, access_email_status: "pending", access_email_pending_at: "2020-01-01T00:00:00.000Z" },
  { id: "checked-out", active: true, checked_in: false, access_enabled: true, access_email_status: "unsent" },
  { id: "inactive", active: false, checked_in: true, access_enabled: false, access_email_status: "unsent" },
] as const;

test("send-all selects only checked-in active recipients without an accepted email", () => {
  assert.deepEqual(
    selectDeliveryRecipients(participants, { mode: "all_unsent", participantIds: [] }, 25).map(({ id }) => id),
    ["unsent", "failed", "stale-pending"],
  );
});

test("selected resend includes only recipients with a prior accepted email", () => {
  assert.deepEqual(
    selectDeliveryRecipients(participants, { mode: "resend", participantIds: ["unsent", "accepted"] }, 25).map(({ id }) => id),
    ["accepted"],
  );
});

test("selected delivery includes checked recipients whether or not they were emailed before", () => {
  assert.deepEqual(
    selectDeliveryRecipients(participants, { mode: "selected", participantIds: ["unsent", "accepted"] }, 25).map(({ id }) => id),
    ["unsent", "accepted"],
  );
});

test("backend delivery excludes a checked-out participant even when explicitly selected", () => {
  assert.deepEqual(
    selectDeliveryRecipients(participants, { mode: "selected", participantIds: ["unsent", "checked-out"] }, 25).map(({ id }) => id),
    ["unsent"],
  );
});

test("backend reports a checked-out selection as an explicit policy skip", () => {
  assert.deepEqual(
    skippedDeliveryResult("checked-out", participants.find(({ id }) => id === "checked-out")),
    { participantId: "checked-out", status: "skipped", error: "check_in_required" },
  );
});

test("backend treats a pending email as an active delivery lease", () => {
  assert.deepEqual(
    selectDeliveryRecipients(participants, { mode: "selected", participantIds: ["pending"] }, 25),
    [],
  );
  assert.deepEqual(
    skippedDeliveryResult("pending", participants.find(({ id }) => id === "pending")),
    { participantId: "pending", status: "skipped", error: "delivery_in_progress" },
  );
  assert.deepEqual(
    selectDeliveryRecipients(participants, { mode: "selected", participantIds: ["stale-pending"] }, 25).map(({ id }) => id),
    ["stale-pending"],
  );
});

test("backend requires the participant to remain checked in and retain the delivery lease", () => {
  assert.equal(deliveryConfirmationError({ id: "participant", checked_in: false, access_email_status: "pending", access_email_pending_at: "2999-01-01T00:00:00.000Z" }), "check_in_required");
  assert.equal(deliveryConfirmationError({ id: "participant", checked_in: true, access_email_status: "accepted" }), "delivery_lease_lost");
  assert.equal(deliveryConfirmationError({ id: "participant", checked_in: true, access_email_status: "pending", access_email_pending_at: "2999-01-01T00:00:00.000Z" }), null);
});

test("provider retries reuse one key while an explicit resend gets a new generation", () => {
  assert.equal(createDeliveryAttemptKey("access-key", 2, "send", "ignored"), "access/access-key/2/send");
  assert.equal(createDeliveryAttemptKey("access-key", 2, "retry", "ignored"), "access/access-key/2/send");
  assert.equal(createDeliveryAttemptKey("access-key", 2, "resend", "request-123"), "access/access-key/2/resend/request-123");
});
