import { createClientFromRequest } from "npm:@base44/sdk";

import { verifyAccessToken } from "./access-link.ts";
import { toPhotoFunctionError } from "./errors.ts";
import { claimFaceCluster, exportParticipantPhotosFolder, listParticipantPhotos, listPeopleClusters, saveParticipantPhotoSelection } from "./service.ts";

const securityHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

Deno.serve(async (request) => {
  try {
    const body = await request.json() as {
      token?: string;
      action?: unknown;
      selectedPhotoIds?: unknown;
      view?: unknown;
      page?: unknown;
      pageSize?: unknown;
      clusterKey?: unknown;
    };
    const base44 = createClientFromRequest(request);
    const participant = body.token
      ? await participantFromAccessLink(base44, body.token)
      : await participantFromAuthenticatedUser(base44);

    if (body.action === "save" || (body.action === undefined && body.selectedPhotoIds !== undefined)) {
      return Response.json(
        await saveParticipantPhotoSelection(base44, participant, body.selectedPhotoIds),
        { headers: securityHeaders },
      );
    }
    if (body.action === "people") {
      return Response.json(
        await listPeopleClusters(base44, participant),
        { headers: securityHeaders },
      );
    }
    if (body.action === "claim" || body.action === "unclaim") {
      return Response.json(
        await claimFaceCluster(base44, participant, body.clusterKey, body.action === "claim"),
        { headers: securityHeaders },
      );
    }
    if (body.action === "export") {
      return Response.json(
        await exportParticipantPhotosFolder(base44, participant),
        { headers: securityHeaders },
      );
    }
    return Response.json(
      await listParticipantPhotos(base44, participant, body),
      { headers: securityHeaders },
    );
  } catch (error) {
    const { message, status } = toPhotoFunctionError(error);
    return Response.json({ error: message }, { status, headers: securityHeaders });
  }
});

async function participantFromAccessLink(base44: any, token: string) {
  if (token.length > 2048) throw new Error("Access link is invalid");
  const secret = Deno.env.get("ACCESS_LINK_SECRET");
  if (!secret) throw new Error("Access link is invalid");
  const payload = await verifyAccessToken(token, secret);
  const participants = await base44.asServiceRole.entities.Participant.filter({ access_key: payload.accessKey }, undefined, 2);
  const participant = participants[0];
  if (
    participants.length !== 1 ||
    !participant ||
    participant.active === false ||
    participant.access_enabled === false ||
    participant.access_version !== payload.version
  ) {
    throw new Error("Access link is invalid");
  }
  return participant;
}

async function participantFromAuthenticatedUser(base44: any) {
  const user = await base44.auth.me();
  if (!user) throw new Error("Authentication required");
  const email = user.email.trim().toLowerCase();
  const participants = await base44.asServiceRole.entities.Participant.filter({ email }, undefined, 1);
  const participant = participants[0];
  if (!participant || participant.active === false) throw new Error("Participant access unavailable");
  return participant;
}
