import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { eventQuickLinks } from "./event-quick-links.ts";

const secret = "a-strong-function-bundle-secret-value";

test("function-local signer and verifier share one token contract", async () => {
  const signers = await Promise.all(["access-admin", "portal-data", "mentor-invite", "judge-invite"].map(loadSigner));
  const verifiers = await Promise.all(["access-portal", "participant-photos", "portal-mcp", "mentor-data", "judge-data"].map(loadVerifier));
  const payload = {
    accessKey: "participant-access-key-1234",
    version: 3,
    expiresAt: "2026-08-01T21:00:00.000Z",
  };

  for (const signer of signers) {
    const token = await signer.signAccessToken(payload, secret);
    for (const verifier of verifiers) {
      assert.deepEqual(await verifier.verifyAccessToken(token, secret, new Date("2026-07-20T12:00:00.000Z")), payload);
    }
  }
});

test("every MCP portal bundle uses the same portal payload builder as the participant portal", async () => {
  const [participantPortal, adminPortal, eventPortal] = await Promise.all([
    readFile(resolve("base44/functions/access-portal/portal-response.ts"), "utf8"),
    readFile(resolve("base44/functions/admin-mcp/portal-response.ts"), "utf8"),
    readFile(resolve("base44/functions/portal-mcp/portal-response.ts"), "utf8"),
  ]);

  assert.equal(adminPortal, participantPortal);
  assert.equal(eventPortal, participantPortal);
});

test("the event MCP serves the same quick links as the portal page", async () => {
  const bundle = await import(pathToFileURL(resolve("base44/functions/portal-mcp/quick-links.ts")).href) as {
    eventQuickLinks: typeof eventQuickLinks;
  };

  assert.deepEqual(bundle.eventQuickLinks, eventQuickLinks);
});

async function loadSigner(functionName: string) {
  return await import(pathToFileURL(resolve(`base44/functions/${functionName}/access-link.ts`)).href) as {
    signAccessToken(payload: { accessKey: string; version: number; expiresAt: string }, secret: string): Promise<string>;
  };
}

async function loadVerifier(functionName: string) {
  return await import(pathToFileURL(resolve(`base44/functions/${functionName}/access-link.ts`)).href) as {
    verifyAccessToken(token: string, secret: string, now?: Date): Promise<unknown>;
  };
}
