import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentConnectPrompt, buildManualInstallSteps, maskEventKey } from "./agent-connect-prompt.ts";

const endpoint = "https://example.base44.app/functions/portal-mcp";
const token = "v1.payload.signature";

test("carries the endpoint and the personal key into the Codex install command", () => {
  const prompt = buildAgentConnectPrompt({ endpoint, token });

  assert.match(prompt, /codex mcp add build-week --url https:\/\/example\.base44\.app\/functions\/portal-mcp --bearer-token-env-var BUILD_WEEK_KEY/);
  assert.match(prompt, /My personal event key: v1\.payload\.signature/);
  assert.match(prompt, /any other client: add a Streamable HTTP MCP server/i);
  assert.equal(/claude/i.test(prompt), false);
});

test("warns the agent that the key is personal and ends with a verification step", () => {
  const prompt = buildAgentConnectPrompt({ endpoint, token });

  assert.match(prompt, /keep it out of git/);
  assert.match(prompt, /call the event_my_status tool/);
});

test("produces nothing without an endpoint or a key so the portal can hide the card", () => {
  assert.equal(buildAgentConnectPrompt({ endpoint, token: "" }), "");
  assert.equal(buildAgentConnectPrompt({ endpoint: "", token }), "");
  assert.equal(buildAgentConnectPrompt({ endpoint: "  ", token: "  " }), "");
  assert.deepEqual(buildManualInstallSteps({ endpoint, token: "" }), []);
});

test("offers a manual path with the raw values and a config block for other clients", () => {
  const steps = buildManualInstallSteps({ endpoint, token });

  assert.deepEqual(steps.map(({ label }) => label), ["Server URL", "Personal event key", "Codex", "Any other client"]);
  assert.equal(steps[0]?.value, endpoint);
  assert.equal(steps[1]?.value, token);
  assert.match(steps[2]?.value ?? "", /^export BUILD_WEEK_KEY="v1\.payload\.signature"\ncodex mcp add build-week --url /);
  assert.deepEqual(JSON.parse(steps[3]?.value ?? "{}"), {
    mcpServers: { "build-week": { type: "http", url: endpoint, headers: { Authorization: `Bearer ${token}` } } },
  });
});

test("masks the key for display while the copied value stays intact", () => {
  const [, , codexStep] = buildManualInstallSteps({ endpoint, token });

  assert.equal(maskEventKey(token, token), "v1.paylo…");
  assert.equal(maskEventKey(codexStep?.value ?? "", token).includes(token), false);
  assert.equal(codexStep?.value.includes(token), true);
});
