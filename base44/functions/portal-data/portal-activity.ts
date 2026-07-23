export async function recordPortalSeen(base44: any, participant: any): Promise<void> {
  const now = new Date().toISOString();
  try {
    await base44.asServiceRole.entities.Participant.update(participant.id, {
      ...(participant.portal_first_seen_at ? {} : { portal_first_seen_at: now }),
      portal_last_seen_at: now,
    });
  } catch {
    // The portal must load even when the visit stamp fails.
  }
}

export async function recordPromoClaim(base44: any, participant: any): Promise<{ ok: boolean }> {
  if (participant.checked_in !== true) return { ok: false };
  if (!participant.promo_claimed_at) {
    await base44.asServiceRole.entities.Participant.update(participant.id, {
      promo_claimed_at: new Date().toISOString(),
    });
  }
  return { ok: true };
}
