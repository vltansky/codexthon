import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("invites the participant through Base44 email", async () => {
  const { sendBase44PortalInvite } = await import(pathToFileURL(resolve("base44/functions/access-admin/email.ts")).href) as {
    sendBase44PortalInvite(
      users: { inviteUser(email: string, role: "user"): Promise<unknown> },
      email: string,
    ): Promise<void>;
  };
  const invitations: Array<{ email: string; role: string }> = [];
  const users = {
    async inviteUser(email: string, role: "user") {
      invitations.push({ email, role });
    },
  };

  await sendBase44PortalInvite(users, "ada@example.com");

  assert.deepEqual(invitations, [{ email: "ada@example.com", role: "user" }]);
});
