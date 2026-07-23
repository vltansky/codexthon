interface UsersModule {
  inviteUser(email: string, role: "user"): Promise<unknown>;
}

export async function sendBase44PortalInvite(users: UsersModule, email: string): Promise<void> {
  await users.inviteUser(email, "user");
}
