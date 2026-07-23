import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface MentorInviteEmailModule {
  buildMentorInviteEmail(input: {
    displayName: string;
    email: string;
    portalUrl: string;
    imageUrl: string;
  }): { subject: string; html: string };
}

async function loadModule(): Promise<MentorInviteEmailModule> {
  return await import(pathToFileURL(resolve("base44/functions/mentor-invite/branded-email.ts")).href) as MentorInviteEmailModule;
}

test("mentor invite email names the mentor, their login email, and the portal link", async () => {
  const { buildMentorInviteEmail } = await loadModule();
  const email = buildMentorInviteEmail({
    displayName: "Radia Perlman",
    email: "radia@example.test",
    portalUrl: "https://portal.example.test",
    imageUrl: "https://portal.example.test/hero.jpg",
  });

  assert.match(email.subject, /mentor/i);
  assert.match(email.html, /Radia Perlman/);
  assert.match(email.html, /radia@example\.test/);
  assert.match(email.html, /href="https:\/\/portal\.example\.test"/);
  assert.match(email.html, /src="https:\/\/portal\.example\.test\/hero\.jpg"/);
});

test("mentor invite email escapes html in mentor-controlled fields", async () => {
  const { buildMentorInviteEmail } = await loadModule();
  const email = buildMentorInviteEmail({
    displayName: "<script>alert(1)</script>",
    email: "a&b@example.test",
    portalUrl: "https://portal.example.test",
    imageUrl: "https://portal.example.test/hero.jpg",
  });

  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /a&amp;b@example\.test/);
});

test("mentor invite bundle shares the gmail sender and app url with access-admin", async () => {
  const [inviteGmail, accessGmail, inviteAppUrl, accessAppUrl] = await Promise.all([
    readFile(resolve("base44/functions/mentor-invite/gmail.ts"), "utf8"),
    readFile(resolve("base44/functions/access-admin/gmail.ts"), "utf8"),
    readFile(resolve("base44/functions/mentor-invite/app-url.ts"), "utf8"),
    readFile(resolve("base44/functions/access-admin/app-url.ts"), "utf8"),
  ]);

  assert.equal(inviteGmail, accessGmail);
  assert.equal(inviteAppUrl, accessAppUrl);
});
