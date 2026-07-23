import assert from "node:assert/strict";
import test from "node:test";

import { accessTokenFromHash, buildAccessHash, buildJudgeHash, buildMentorHash, judgeTokenFromHash, mentorTokenFromHash } from "./access-session.ts";

test("reads an encoded participant token from the URL fragment", () => {
  assert.equal(accessTokenFromHash("#access=v1.payload%2Esignature"), "v1.payload.signature");
  assert.equal(accessTokenFromHash("#other=value"), null);
});

test("builds a fragment that keeps the bearer token out of HTTP requests", () => {
  assert.equal(buildAccessHash("v1.payload.signature"), "#access=v1.payload.signature");
});

test("reads an encoded mentor token from the URL fragment", () => {
  assert.equal(mentorTokenFromHash("#mentor=v1.payload%2Esignature"), "v1.payload.signature");
  assert.equal(mentorTokenFromHash("#access=value"), null);
});

test("mentor and participant fragments never collide", () => {
  assert.equal(buildMentorHash("v1.payload.signature"), "#mentor=v1.payload.signature");
  assert.equal(accessTokenFromHash(buildMentorHash("v1.payload.signature")), null);
});

test("reads an encoded judge token from the URL fragment", () => {
  assert.equal(judgeTokenFromHash("#judge=v1.payload%2Esignature"), "v1.payload.signature");
  assert.equal(judgeTokenFromHash("#mentor=value"), null);
});

test("judge fragments never collide with participant or mentor fragments", () => {
  assert.equal(buildJudgeHash("v1.payload.signature"), "#judge=v1.payload.signature");
  assert.equal(accessTokenFromHash(buildJudgeHash("v1.payload.signature")), null);
  assert.equal(mentorTokenFromHash(buildJudgeHash("v1.payload.signature")), null);
});
