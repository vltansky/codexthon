import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("inactive participants cannot be checked in or assigned a promo", async () => {
  const eligibility = await import(pathToFileURL(resolve("base44/functions/check-in-participants/eligibility.ts")).href) as {
    canApplyCheckIn(participant: { active?: boolean; access_email_status?: string; access_email_pending_at?: string } | null, checkedIn: boolean): boolean;
    findAvailablePromo<T extends { code?: string; codex_credit_url?: string; api_credit_url?: string; api_credit_code?: string }>(promos: T[]): T | undefined;
  };

  assert.equal(eligibility.canApplyCheckIn({ active: false }, true), false);
  assert.equal(eligibility.canApplyCheckIn({ active: false }, false), true);
  assert.equal(eligibility.canApplyCheckIn({ active: true }, true), true);
  assert.equal(eligibility.canApplyCheckIn({}, true), true);
  assert.equal(eligibility.canApplyCheckIn(null, false), false);
  assert.equal(eligibility.canApplyCheckIn({ active: true, access_email_status: "pending", access_email_pending_at: "2999-01-01T00:00:00.000Z" }, false), false);
  assert.equal(eligibility.canApplyCheckIn({ active: true, access_email_status: "pending", access_email_pending_at: "2020-01-01T00:00:00.000Z" }, false), true);

  const complete = { id: "complete", codex_credit_url: "https://example.com/codex", api_credit_url: "https://example.com/api" };
  const completeWithApiCode = { id: "complete-code", codex_credit_url: "https://example.com/codex-code", api_credit_code: "API-CODE" };
  assert.equal(eligibility.findAvailablePromo([
    { id: "missing-api", codex_credit_url: "https://example.com/incomplete" },
    completeWithApiCode,
    complete,
  ]), completeWithApiCode);
});
