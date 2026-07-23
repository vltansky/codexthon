import { hasActiveDeliveryLease } from "./eligibility.ts";

interface EntityRecord extends Record<string, unknown> {
  id: string;
}

interface EntityApi {
  filter(query: Record<string, unknown>, sort?: string, limit?: number): Promise<EntityRecord[]>;
  update(id: string, data: Record<string, unknown>): Promise<EntityRecord>;
}

interface ParticipantEntityApi extends EntityApi {
  get(id: string): Promise<EntityRecord | null>;
}

interface ParticipantEmailClient {
  asServiceRole: {
    entities: {
      Participant: ParticipantEntityApi;
      PromoCode: EntityApi;
    };
  };
}

export class ParticipantEmailChangeError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function changeParticipantEmail(base44: ParticipantEmailClient, participantId: string, requestedEmail: string) {
  const email = requestedEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ParticipantEmailChangeError("Enter a valid email address", 400);
  }
  const participant = await base44.asServiceRole.entities.Participant.get(participantId);
  if (!participant || participant.active === false) {
    throw new ParticipantEmailChangeError("Participant not found", 404);
  }
  const previousEmail = String(participant.email).trim().toLowerCase();
  if (email === previousEmail) return { participantId, previousEmail, email };
  if (hasActiveDeliveryLease({
    access_email_status: typeof participant.access_email_status === "string" ? participant.access_email_status : undefined,
    access_email_pending_at: typeof participant.access_email_pending_at === "string" ? participant.access_email_pending_at : undefined,
  })) {
    throw new ParticipantEmailChangeError("Access email delivery is in progress", 409);
  }
  const matches = await base44.asServiceRole.entities.Participant.filter({ email }, undefined, 2);
  if (matches.some(({ id }) => id !== participantId)) {
    throw new ParticipantEmailChangeError("A participant with this email already exists", 409);
  }
  const promos = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: previousEmail }, "created_date", 5000);
  const updatedPromos: EntityRecord[] = [];

  try {
    for (const promo of promos) {
      await base44.asServiceRole.entities.PromoCode.update(promo.id, { assigned_email: email });
      updatedPromos.push(promo);
    }
    await base44.asServiceRole.entities.Participant.update(participantId, {
      email,
      access_email_status: "unsent",
      access_email_pending_at: "",
      access_email_accepted_at: "",
    });
  } catch (error) {
    await Promise.allSettled(updatedPromos.map(({ id }) =>
      base44.asServiceRole.entities.PromoCode.update(id, { assigned_email: previousEmail })
    ));
    throw error;
  }

  return { participantId, previousEmail, email };
}
