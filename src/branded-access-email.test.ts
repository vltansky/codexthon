import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("uses the custom event domain for participant access", async () => {
  Object.assign(globalThis, { Deno: { env: { get: (name: string) => name === "APP_URL" ? "https://portal.example.test/path" : undefined } } });
  const { appUrl } = await import(
    pathToFileURL(resolve("base44/functions/access-admin/app-url.ts")).href
  ) as { appUrl(): string };

  assert.equal(appUrl(), "https://portal.example.test");
});

test("builds a branded access email with the participant's unique link", async () => {
  const { buildBrandedAccessEmail } = await import(
    pathToFileURL(resolve("base44/functions/access-admin/branded-email.ts")).href
  ) as {
    buildBrandedAccessEmail(input: {
      displayName: string;
      accessUrl: string;
      imageUrl: string;
    }): { subject: string; html: string };
  };

  const email = buildBrandedAccessEmail({
    displayName: "Ada <Lovelace>",
    accessUrl: "https://example.com/#access=unique-token",
    imageUrl: "https://example.com/codex-email-hero.jpg",
  });

  assert.equal(email.subject, "You're checked in — your promo code is ready");
  assert.match(email.html, /OpenAI Build Week Tel Aviv/);
  assert.doesNotMatch(email.html, /Independently organized community event/);
  assert.match(email.html, /You’re checked in/);
  assert.match(email.html, /Your personal ChatGPT promo code is now unlocked/);
  assert.match(email.html, /View my promo code/);
  assert.doesNotMatch(email.html, /portal is ready/i);
  assert.match(email.html, /codex-email-hero\.jpg/);
  assert.match(email.html, /#access=unique-token/);
  assert.doesNotMatch(email.html, /Ada <Lovelace>/);
  assert.match(email.html, /Ada &lt;Lovelace&gt;/);
});

test("sends the branded email through the shared Base44 Gmail connector", async () => {
  const { sendGmailAccessEmail } = await import(
    pathToFileURL(resolve("base44/functions/access-admin/gmail.ts")).href
  ) as {
    sendGmailAccessEmail(input: {
      connectors: { getConnection(type: string): Promise<{ accessToken: string }> };
      fetcher: typeof fetch;
      to: string;
      subject: string;
      html: string;
    }): Promise<string>;
  };
  let connectorType = "";
  const requests: Array<{ url: string; authorization: string; raw: string }> = [];

  const subject = "You're checked in — your promo code is ready";
  const messageId = await sendGmailAccessEmail({
    connectors: {
      async getConnection(type) {
        connectorType = type;
        return { accessToken: "gmail-access-token" };
      },
    },
    fetcher: async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { raw: string };
      requests.push({
        url: String(input),
        authorization: String(new Headers(init?.headers).get("Authorization")),
        raw: Buffer.from(body.raw, "base64url").toString("utf8"),
      });
      return new Response(JSON.stringify({ id: "gmail-message-123" }), { status: 200 });
    },
    to: "ada@example.com",
    subject,
    html: "<h1>Build Week</h1><a href=\"https://example.com/#access=unique-token\">Open</a>",
  });

  assert.equal(connectorType, "gmail");
  assert.equal(messageId, "gmail-message-123");
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assert.equal(request.authorization, "Bearer gmail-access-token");
  assert.match(request.raw, /To: ada@example\.com/);
  const encodedSubject = request.raw.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m)?.[1];
  assert.ok(encodedSubject);
  assert.equal(Buffer.from(encodedSubject, "base64").toString("utf8"), subject);
  assert.match(request.raw, /#access=unique-token/);
});
