import assert from "node:assert/strict";
import test from "node:test";

import { planPromoImport } from "./promo-import.ts";
import { isCompletePromo } from "./promo-inventory.ts";

test("imports one allocation type and deduplicates it on re-upload", () => {
  const apiRows = [
    { codexCreditUrl: "", apiCreditValue: "API-1" },
    { codexCreditUrl: "", apiCreditValue: "API-2" },
  ];

  const firstImport = planPromoImport(apiRows, []);
  assert.deepEqual(firstImport.creates, [
    { code: "", codex_credit_url: "", api_credit_code: "API-1", api_credit_url: "", assigned_email: "", assigned_at: "" },
    { code: "", codex_credit_url: "", api_credit_code: "API-2", api_credit_url: "", assigned_email: "", assigned_at: "" },
  ]);
  assert.equal(isCompletePromo(firstImport.creates[0]!), false);

  const existing = firstImport.creates.map((promo, index) => ({ ...promo, id: `promo-${index}` }));
  assert.deepEqual(planPromoImport(apiRows, existing), {
    creates: [],
    updates: [],
    unchanged: 2,
  });
});

test("completes staged allocation rows when the other CSV is uploaded later", () => {
  const existing = [
    { id: "promo-1", code: "", codex_credit_url: "", api_credit_code: "API-1", api_credit_url: "", assigned_email: "", assigned_at: "" },
    { id: "promo-2", code: "", codex_credit_url: "", api_credit_code: "API-2", api_credit_url: "", assigned_email: "", assigned_at: "" },
  ];

  assert.deepEqual(planPromoImport([
    { codexCreditUrl: "https://chatgpt.com/codex/p/CODEX-1", apiCreditValue: "" },
    { codexCreditUrl: "https://chatgpt.com/codex/p/CODEX-2", apiCreditValue: "" },
  ], existing), {
    creates: [],
    updates: [
      { id: "promo-1", data: { code: "https://chatgpt.com/codex/p/CODEX-1", codex_credit_url: "https://chatgpt.com/codex/p/CODEX-1" } },
      { id: "promo-2", data: { code: "https://chatgpt.com/codex/p/CODEX-2", codex_credit_url: "https://chatgpt.com/codex/p/CODEX-2" } },
    ],
    unchanged: 0,
  });
});
