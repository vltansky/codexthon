import { createClientFromRequest } from "npm:@base44/sdk";
import { addException, claimPromo, getAssignablePromo, promoLinks, reassignPromo } from "./add-exception.ts";
import { canApplyCheckIn, findAvailablePromo, hasActiveDeliveryLease } from "./eligibility.ts";
import { changeParticipantEmail, ParticipantEmailChangeError } from "./participant-email-change.ts";

interface CheckInUpdate {
  email: string;
  checkedIn: boolean;
}

Deno.serve(async (request) => {
  try {
    const base44 = createClientFromRequest(request);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown> & { updates?: CheckInUpdate[] };
    if (body.action === "add-exception") return addException(base44, body);
    if (body.action === "assign-promo") return assignPromo(base44, body);
    if (body.action === "reassign-promo") return reassignPromoResponse(base44, body);
    if (body.action === "update-email") return updateEmail(base44, body);
    const updates = Array.isArray(body.updates) ? body.updates.slice(0, 500) : [];
    if (!updates.length) {
      return Response.json({ error: "At least one check-in update is required" }, { status: 400 });
    }

    const results = [];
    for (const update of updates) {
      const email = update.email.trim().toLowerCase();
      const participants = await base44.asServiceRole.entities.Participant.filter({ email }, undefined, 1);
      const participant = participants[0];
      if (!canApplyCheckIn(participant, update.checkedIn)) {
        const error = !update.checkedIn && participant && hasActiveDeliveryLease(participant)
          ? "Access email delivery is in progress"
          : "Participant is not active";
        results.push({ email, success: false, error });
        continue;
      }

      if (update.checkedIn) {
        const assignments = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: email }, undefined, 1);
        if (!assignments.length) {
          const availableCodes = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: "" }, "created_date", 5000);
          const availableCode = findAvailablePromo(availableCodes);
          if (!availableCode) {
            results.push({ email, success: false, error: "No complete promo pairs available" });
            continue;
          }
          await base44.asServiceRole.entities.PromoCode.update(availableCode.id, {
            assigned_email: email,
            assigned_at: new Date().toISOString(),
          });
        }
      }

      await base44.asServiceRole.entities.Participant.update(participant.id, {
        checked_in: update.checkedIn,
        checked_in_at: update.checkedIn ? new Date().toISOString() : "",
      });
      results.push({ email, success: true, checkedIn: update.checkedIn });
    }

    return Response.json({ results });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update check-ins" },
      { status: 500 },
    );
  }
});

async function updateEmail(base44: any, body: Record<string, unknown>) {
  try {
    const result = await changeParticipantEmail(
      base44,
      stringValue(body.participantId),
      stringValue(body.email),
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof ParticipantEmailChangeError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

async function assignPromo(base44: any, body: Record<string, unknown>) {
  const participantId = stringValue(body.participantId);
  const participant = participantId ? await base44.asServiceRole.entities.Participant.get(participantId) : null;
  if (!participant || participant.active === false) {
    return Response.json({ error: "Participant not found" }, { status: 404 });
  }
  const promo = await getAssignablePromo(base44, participant.email.trim().toLowerCase());
  const assignedPromo = promo.assigned_email ? promo : await claimPromo(base44, promo, participant.email.trim().toLowerCase());
  return Response.json({ participantId, promoLinks: promoLinks(assignedPromo) });
}

async function reassignPromoResponse(base44: any, body: Record<string, unknown>) {
  const participantId = stringValue(body.participantId);
  const participant = participantId ? await base44.asServiceRole.entities.Participant.get(participantId) : null;
  if (!participant || participant.active === false) {
    return Response.json({ error: "Participant not found" }, { status: 404 });
  }
  const assignedPromo = await reassignPromo(base44, participant.email.trim().toLowerCase());
  return Response.json({ participantId, promoLinks: promoLinks(assignedPromo) });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
