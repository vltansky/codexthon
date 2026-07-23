export function canApplyCheckIn(
  participant: { active?: boolean; access_email_status?: string; access_email_pending_at?: string } | null | undefined,
  checkedIn: boolean,
): boolean {
  if (!participant) return false;
  if (!checkedIn && hasActiveDeliveryLease(participant)) return false;
  return !checkedIn || participant.active !== false;
}

export function hasActiveDeliveryLease(
  participant: { access_email_status?: string; access_email_pending_at?: string },
  now = Date.now(),
): boolean {
  if (participant.access_email_status !== "pending") return false;
  const pendingAt = Date.parse(participant.access_email_pending_at ?? "");
  return Number.isFinite(pendingAt) && pendingAt + 2 * 60 * 1000 > now;
}

export function findAvailablePromo<T extends { code?: string; codex_credit_url?: string; api_credit_url?: string; api_credit_code?: string; blocked?: boolean }>(promos: T[]): T | undefined {
  return promos.find((promo) => promo.blocked !== true && Boolean((promo.codex_credit_url || promo.code) && (promo.api_credit_code || promo.api_credit_url)));
}
