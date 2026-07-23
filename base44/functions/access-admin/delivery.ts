export type DeliveryMode = "selected" | "all_unsent" | "resend";
type DeliveryAttemptMode = "send" | "retry" | "resend";

interface DeliveryParticipant {
  id: string;
  active?: boolean;
  checked_in?: boolean;
  access_enabled?: boolean;
  access_email_status?: string;
  access_email_pending_at?: string;
}

const deliveryLeaseDurationMs = 2 * 60 * 1000;

export function hasActiveDeliveryLease(participant: DeliveryParticipant, now = Date.now()): boolean {
  if (participant.access_email_status !== "pending") return false;
  const pendingAt = Date.parse(participant.access_email_pending_at ?? "");
  return Number.isFinite(pendingAt) && pendingAt + deliveryLeaseDurationMs > now;
}

export function deliveryBlockReason(participant: DeliveryParticipant | null | undefined): string | null {
  if (!participant || participant.active === false) return "participant_not_active";
  if (participant.checked_in !== true) return "check_in_required";
  if (participant.access_enabled === false) return "access_disabled";
  if (hasActiveDeliveryLease(participant)) return "delivery_in_progress";
  return null;
}

export function skippedDeliveryResult(participantId: string, participant: DeliveryParticipant | null | undefined) {
  return { participantId, status: "skipped", error: deliveryBlockReason(participant) ?? "not_eligible" };
}

export function deliveryConfirmationError(participant: DeliveryParticipant | null | undefined): string | null {
  if (!participant || participant.active === false) return "participant_not_active";
  if (participant.checked_in !== true) return "check_in_required";
  if (participant.access_enabled === false) return "access_disabled";
  return hasActiveDeliveryLease(participant) ? null : "delivery_lease_lost";
}

export function selectDeliveryRecipients<T extends DeliveryParticipant>(
  participants: readonly T[],
  input: { mode: DeliveryMode; participantIds: string[] },
  limit: number,
): T[] {
  const selectedIds = new Set(input.participantIds);
  return participants.filter((participant) => {
    if (deliveryBlockReason(participant)) return false;
    if (input.mode !== "all_unsent" && !selectedIds.has(participant.id)) return false;
    if (input.mode === "selected") return true;
    if (input.mode === "resend") return participant.access_email_status === "accepted";
    return participant.access_email_status !== "accepted";
  }).slice(0, limit);
}

export function createDeliveryAttemptKey(
  accessKey: string,
  accessVersion: number,
  mode: DeliveryAttemptMode,
  requestId: string,
): string {
  const prefix = `access/${accessKey}/${accessVersion}`;
  if (mode !== "resend") return `${prefix}/send`;
  if (!requestId.trim()) throw new Error("A request ID is required for resend");
  return `${prefix}/resend/${requestId}`;
}
