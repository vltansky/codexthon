import { createClientFromRequest } from "npm:@base44/sdk";

import { appUrl } from "./app-url.ts";
import { createDeliveryAttemptKey, deliveryBlockReason, deliveryConfirmationError, hasActiveDeliveryLease, selectDeliveryRecipients, skippedDeliveryResult, type DeliveryMode } from "./delivery.ts";
import { buildBrandedAccessEmail } from "./branded-email.ts";
import { sendGmailAccessEmail } from "./gmail.ts";
import { signAccessToken } from "./access-link.ts";

const defaultExpiry = "2026-08-01T21:00:00.000Z";
const batchSize = 25;
const privateResponse = { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } };

Deno.serve(async (request) => {
  try {
    const base44 = createClientFromRequest(request);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") return Response.json({ error: "Admin access required" }, { status: 403 });
    const secret = Deno.env.get("ACCESS_LINK_SECRET");
    if (!secret) return Response.json({ error: "Access links are not configured" }, { status: 503 });
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "links") return linksResponse(base44, body, secret);
    if (body.action === "rotate") return rotateResponse(base44, body, secret);
    if (body.action === "email") return emailResponse(base44, user.email, body, secret);
    if (body.action === "send") return sendResponse(base44, user.email, body, secret);
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Access operation failed" }, { status: 500 });
  }
});

async function linksResponse(base44: any, body: Record<string, unknown>, secret: string) {
  const participantIds = stringArray(body.participantIds).slice(0, 100);
  if (!participantIds.length) return Response.json({ error: "Select at least one participant" }, { status: 400 });
  const links = [];
  for (const participantId of participantIds) {
    const participant = await getReadyParticipant(base44, participantId);
    if (!participant) continue;
    links.push({
      participantId,
      url: await createAccessUrl(participant, secret),
      version: participant.access_version,
      expiresAt: participant.access_expires_at,
    });
  }
  return Response.json({ links }, privateResponse);
}

async function rotateResponse(base44: any, body: Record<string, unknown>, secret: string) {
  const participantId = typeof body.participantId === "string" ? body.participantId : "";
  const participant = participantId ? await base44.asServiceRole.entities.Participant.get(participantId) : null;
  if (!participant || participant.active === false || participant.checked_in !== true) {
    return Response.json({ error: "Participant must be checked in" }, { status: 409 });
  }
  if (hasActiveDeliveryLease(participant)) {
    return Response.json({ error: "Access email delivery is in progress" }, { status: 409 });
  }
  const nextVersion = (participant.access_version || 1) + 1;
  const data = {
    access_key: participant.access_key || crypto.randomUUID(),
    access_version: nextVersion,
    access_enabled: true,
    access_expires_at: participant.access_expires_at || defaultExpiry,
    access_email_status: "unsent",
    access_email_accepted_at: "",
  };
  await base44.asServiceRole.entities.Participant.update(participantId, data);
  return Response.json(
    { participantId, version: nextVersion, url: await createAccessUrl({ ...participant, ...data }, secret) },
    privateResponse,
  );
}

async function emailResponse(base44: any, actorEmail: string, body: Record<string, unknown>, secret: string) {
  const participantId = typeof body.participantId === "string" ? body.participantId : "";
  const participant = participantId ? await getReadyParticipant(base44, participantId) : null;
  if (!participant) return Response.json({ error: "Participant not found" }, { status: 404 });
  const requestId = crypto.randomUUID();
  const action = participant.access_email_status === "accepted" ? "resend" : "send";
  const attempt = await base44.asServiceRole.entities.AccessDeliveryAttempt.create({
    participant_id: participant.id,
    participant_email: participant.email,
    access_version: participant.access_version,
    action,
    request_id: requestId,
    attempt_key: createDeliveryAttemptKey(participant.access_key, participant.access_version, action, requestId),
    status: "pending",
    provider_message_id: "",
    error_code: "",
    actor_email: actorEmail,
    attempted_at: new Date().toISOString(),
  });
  await base44.asServiceRole.entities.Participant.update(participant.id, { access_email_status: "pending", access_email_pending_at: new Date().toISOString() });
  const confirmedParticipant = await base44.asServiceRole.entities.Participant.get(participant.id);
  const confirmationError = deliveryConfirmationError(confirmedParticipant);
  if (confirmationError) {
    return Response.json(await skipAttempt(base44, participant, attempt, participant.access_email_status, confirmationError), privateResponse);
  }
  try {
    const messageId = await sendBrandedAccessEmail(base44, participant, secret);
    return Response.json(await acceptAttempt(base44, participant, attempt, messageId), privateResponse);
  } catch (error) {
    await failAttempt(base44, participant, attempt, "failed", "gmail_send_failed");
    const detail = error instanceof Error ? error.message : "Gmail is unavailable";
    console.error("Access email delivery failed", { participantId: participant.id, detail });
    return Response.json({ error: `${detail}. Connect Gmail in Base44 Dashboard → Integrations.` }, { status: 502, ...privateResponse });
  }
}

async function sendResponse(base44: any, actorEmail: string, body: Record<string, unknown>, secret: string) {
  const mode = body.mode as DeliveryMode;
  if (!(["selected", "all_unsent", "resend"] as const).includes(mode)) {
    return Response.json({ error: "Invalid delivery mode" }, { status: 400 });
  }
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!requestId) return Response.json({ error: "Request ID is required" }, { status: 400 });
  const participants = await base44.asServiceRole.entities.Participant.list("display_name", 5000);
  const participantIds = stringArray(body.participantIds);
  const participantsById = new Map(participants.map((participant: any) => [participant.id, participant]));
  const excludedIds = new Set(stringArray(body.excludeParticipantIds));
  const allEligible = selectDeliveryRecipients(
    participants.filter((participant: any) => !excludedIds.has(participant.id)),
    { mode, participantIds },
    5000,
  );
  const eligibleIds = new Set(allEligible.map((participant: any) => participant.id));
  const skippedResults = mode === "all_unsent"
    ? []
    : participantIds.filter((participantId) => !eligibleIds.has(participantId))
      .map((participantId) => skippedDeliveryResult(participantId, participantsById.get(participantId)));
  const recipients = allEligible.slice(0, batchSize);
  const deliveryResults = [];
  for (const participant of recipients) deliveryResults.push(await deliver(base44, actorEmail, participant, mode, requestId, secret));
  return Response.json({
    results: [...deliveryResults, ...skippedResults],
    processed: deliveryResults.length,
    skipped: skippedResults.length,
    hasMore: allEligible.length > recipients.length,
    remaining: Math.max(0, allEligible.length - recipients.length),
  });
}

async function deliver(base44: any, actorEmail: string, inputParticipant: any, mode: DeliveryMode, requestId: string, secret: string) {
  const participant = await getReadyParticipant(base44, inputParticipant.id);
  if (!participant) return { participantId: inputParticipant.id, status: "failed", error: "Participant is not eligible" };
  const action = mode === "resend" || participant.access_email_status === "accepted"
    ? "resend"
    : ["failed", "unknown"].includes(participant.access_email_status) ? "retry" : "send";
  const attemptKey = createDeliveryAttemptKey(participant.access_key, participant.access_version, action, requestId);
  const attempt = await base44.asServiceRole.entities.AccessDeliveryAttempt.create({
    participant_id: participant.id,
    participant_email: participant.email,
    access_version: participant.access_version,
    action,
    request_id: requestId,
    attempt_key: attemptKey,
    status: "pending",
    provider_message_id: "",
    error_code: "",
    actor_email: actorEmail,
    attempted_at: new Date().toISOString(),
  });
  await base44.asServiceRole.entities.Participant.update(participant.id, { access_email_status: "pending", access_email_pending_at: new Date().toISOString() });
  const confirmedParticipant = await base44.asServiceRole.entities.Participant.get(participant.id);
  const confirmationError = deliveryConfirmationError(confirmedParticipant);
  if (confirmationError) {
    return skipAttempt(base44, participant, attempt, participant.access_email_status, confirmationError);
  }

  try {
    const messageId = await sendBrandedAccessEmail(base44, participant, secret);
    return acceptAttempt(base44, participant, attempt, messageId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Gmail is unavailable";
    console.error("Bulk access email delivery failed", { participantId: participant.id, detail });
    return failAttempt(base44, participant, attempt, "failed", "gmail_send_failed");
  }
}

async function sendBrandedAccessEmail(base44: any, participant: any, secret: string) {
  const accessUrl = await createAccessUrl(participant, secret);
  const baseUrl = appUrl();
  const email = buildBrandedAccessEmail({
    displayName: participant.display_name,
    accessUrl,
    imageUrl: `${baseUrl}/codex-email-hero.jpg`,
  });
  return sendGmailAccessEmail({
    connectors: base44.asServiceRole.connectors,
    fetcher: fetch,
    to: participant.email,
    subject: email.subject,
    html: email.html,
  });
}

async function acceptAttempt(base44: any, participant: any, attempt: any, providerMessageId = "") {
  const acceptedAt = new Date().toISOString();
  await Promise.all([
    base44.asServiceRole.entities.AccessDeliveryAttempt.update(attempt.id, { status: "accepted", provider_message_id: providerMessageId }),
    base44.asServiceRole.entities.Participant.update(participant.id, { access_email_status: "accepted", access_email_pending_at: "", access_email_accepted_at: acceptedAt }),
  ]);
  return { participantId: participant.id, status: "accepted" };
}

async function failAttempt(base44: any, participant: any, attempt: any, status: "failed" | "unknown", errorCode: string) {
  await Promise.all([
    base44.asServiceRole.entities.AccessDeliveryAttempt.update(attempt.id, { status, error_code: errorCode }),
    base44.asServiceRole.entities.Participant.update(participant.id, { access_email_status: status, access_email_pending_at: "" }),
  ]);
  return { participantId: participant.id, status, error: errorCode };
}

async function skipAttempt(base44: any, participant: any, attempt: any, previousEmailStatus: string, errorCode: string) {
  await Promise.all([
    base44.asServiceRole.entities.AccessDeliveryAttempt.update(attempt.id, { status: "skipped", error_code: errorCode }),
    base44.asServiceRole.entities.Participant.update(participant.id, { access_email_status: previousEmailStatus, access_email_pending_at: "" }),
  ]);
  return { participantId: participant.id, status: "skipped", error: errorCode };
}

async function getReadyParticipant(base44: any, participantId: string) {
  const participant = await base44.asServiceRole.entities.Participant.get(participantId);
  if (deliveryBlockReason(participant)) return null;
  const data = {
    access_key: participant.access_key || crypto.randomUUID(),
    access_version: participant.access_version || 1,
    access_enabled: true,
    access_expires_at: participant.access_expires_at || defaultExpiry,
    access_email_status: participant.access_email_status || "unsent",
  };
  if (!participant.access_key || !participant.access_version || !participant.access_expires_at || !participant.access_email_status) {
    await base44.asServiceRole.entities.Participant.update(participantId, data);
  }
  return { ...participant, ...data };
}

async function createAccessUrl(participant: any, secret: string) {
  const token = await signAccessToken({
    accessKey: participant.access_key,
    version: participant.access_version,
    expiresAt: participant.access_expires_at,
  }, secret);
  return `${appUrl()}/#access=${encodeURIComponent(token)}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
