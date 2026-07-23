import assert from "node:assert/strict";
import test from "node:test";

import { unwrapBase44FunctionResponse } from "./base44-response.ts";

test("unwraps Base44 function JSON from the Axios response data field", () => {
  assert.deepEqual(unwrapBase44FunctionResponse({ data: { results: ["ok"] } }), {
    results: ["ok"],
  });
});

test("rejects malformed Base44 function responses", () => {
  assert.throws(() => unwrapBase44FunctionResponse({}), /missing response data/);
});
