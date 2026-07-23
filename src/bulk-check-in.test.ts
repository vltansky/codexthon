import assert from "node:assert/strict";
import test from "node:test";

import { runBulkCheckIn } from "./bulk-check-in.ts";

test("bulk check-in preserves completed results and returns participants left after an interrupted batch", async () => {
  const participants = [
    { id: "one", email: "one@example.com" },
    { id: "two", email: "two@example.com" },
    { id: "three", email: "three@example.com" },
  ];
  const outcome = await runBulkCheckIn(participants, 2, async (batch) => {
    if (batch[0]?.id === "three") throw new Error("Base44 unavailable");
    return batch.map(({ email }) => ({ email, success: true }));
  });

  assert.deepEqual(outcome.results, [
    { email: "one@example.com", success: true },
    { email: "two@example.com", success: true },
  ]);
  assert.deepEqual(outcome.unprocessed.map(({ id }) => id), ["three"]);
  assert.equal(outcome.error, "Base44 unavailable");
});
