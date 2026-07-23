import assert from "node:assert/strict";
import test from "node:test";

import { accessTokenFromHash, buildAccessHash } from "./access-session.ts";

test("reads an encoded participant token from the URL fragment", () => {
  assert.equal(accessTokenFromHash("#access=v1.payload%2Esignature"), "v1.payload.signature");
  assert.equal(accessTokenFromHash("#other=value"), null);
});

test("builds a fragment that keeps the bearer token out of HTTP requests", () => {
  assert.equal(buildAccessHash("v1.payload.signature"), "#access=v1.payload.signature");
});
