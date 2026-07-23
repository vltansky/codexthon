import assert from "node:assert/strict";
import test from "node:test";

import { countAvailableCredits, getPromoInventoryStatus, isAvailablePromo } from "./promo-inventory.ts";

test("only complete unassigned promo pairs are available", () => {
  const complete = { codex_credit_url: "https://example.test/codex", api_credit_code: "api-credit", assigned_email: "" };
  const missingApi = { codex_credit_url: "https://example.test/codex", api_credit_code: "", assigned_email: "" };

  assert.equal(isAvailablePromo(complete), true);
  assert.equal(getPromoInventoryStatus(complete), "available");
  assert.equal(isAvailablePromo(missingApi), false);
  assert.equal(getPromoInventoryStatus(missingApi), "incomplete");
});

test("assigned records remain assigned even when legacy data is incomplete", () => {
  const assignedLegacyRecord = {
    code: "legacy-codex-credit",
    api_credit_code: "",
    assigned_email: "participant@example.test",
  };

  assert.equal(isAvailablePromo(assignedLegacyRecord), false);
  assert.equal(getPromoInventoryStatus(assignedLegacyRecord), "assigned");
});

test("blocked promo credits cannot be assigned", () => {
  const blocked = {
    codex_credit_url: "https://example.test/codex",
    api_credit_code: "api-credit",
    assigned_email: "",
    blocked: true,
  };

  assert.equal(isAvailablePromo(blocked), false);
  assert.equal(getPromoInventoryStatus(blocked), "blocked");
});

test("counts unassigned Codex and API credits separately", () => {
  const inventory = [
    { codex_credit_url: "https://example.test/codex-1", api_credit_code: "api-1", assigned_email: "" },
    { codex_credit_url: "https://example.test/codex-2", assigned_email: "" },
    { api_credit_code: "api-2", assigned_email: "" },
    { codex_credit_url: "https://example.test/blocked", api_credit_code: "blocked", assigned_email: "", blocked: true },
    { codex_credit_url: "https://example.test/assigned", api_credit_code: "assigned", assigned_email: "person@example.test" },
  ];

  assert.deepEqual(countAvailableCredits(inventory), { codex: 2, api: 2 });
});
