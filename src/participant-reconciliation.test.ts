import assert from "node:assert/strict";
import test from "node:test";

import { reconcileParticipants } from "./participant-reconciliation.ts";

const importedParticipant = {
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  teamKey: "compiler-crew",
  teamName: "Compiler Crew",
  mentorKey: "grace-hopper",
  mentorName: "Grace Hopper",
  mentorEmail: "",
  mentorPhone: "",
  mentorDetails: "",
};

test("re-import preserves participant access identity and event state", () => {
  const result = reconcileParticipants(
    [importedParticipant],
    [{
      id: "participant-1",
      email: "ada@example.com",
      display_name: "Old Name",
      team_key: "old-team",
      team_name: "Old Team",
      mentor_key: "old-mentor",
      checked_in: true,
      checked_in_at: "2026-07-20T10:00:00.000Z",
      access_key: "stable-access-key-1234",
      access_version: 4,
      access_enabled: true,
      access_expires_at: "2026-08-01T21:00:00.000Z",
      access_email_status: "accepted",
    }],
    () => "new-key-must-not-be-used",
    "2026-08-01T21:00:00.000Z",
  );

  assert.deepEqual(result.creates, []);
  assert.deepEqual(result.updates, [{
    id: "participant-1",
    data: {
      email: "ada@example.com",
      display_name: "Ada Lovelace",
      team_key: "compiler-crew",
      team_name: "Compiler Crew",
      mentor_key: "grace-hopper",
      active: true,
      access_enabled: true,
    },
  }]);
  assert.deepEqual(result.deactivations, []);
});

test("new participants receive a unique access identity and removed participants are revoked", () => {
  const result = reconcileParticipants(
    [importedParticipant],
    [{
      id: "participant-removed",
      email: "removed@example.com",
      display_name: "Removed Guest",
      team_key: "old-team",
      team_name: "Old Team",
      mentor_key: "old-mentor",
      checked_in: false,
    }],
    () => "generated-access-key-1234",
    "2026-08-01T21:00:00.000Z",
  );

  assert.equal(result.creates[0]?.access_key, "generated-access-key-1234");
  assert.equal(result.creates[0]?.access_version, 1);
  assert.equal(result.creates[0]?.active, true);
  assert.deepEqual(result.deactivations, [{ id: "participant-removed", data: { active: false, access_enabled: false } }]);
});

test("manual exceptions stay active when they are absent from a roster import", () => {
  const result = reconcileParticipants(
    [importedParticipant],
    [{
      id: "participant-exception",
      email: "exception@example.com",
      display_name: "Exception Guest",
      team_key: "compiler-crew",
      team_name: "Compiler Crew",
      mentor_key: "grace-hopper",
      checked_in: false,
      is_exception: true,
    }],
    () => "generated-access-key-1234",
    "2026-08-01T21:00:00.000Z",
  );

  assert.deepEqual(result.deactivations, []);
});
