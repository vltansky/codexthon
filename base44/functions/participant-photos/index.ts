import { createClientFromRequest } from "npm:@base44/sdk";

import { verifyAccessToken } from "./access-link.ts";
import { toPhotoFunctionError } from "./errors.ts";
import {
  claimFaceCluster,
  exportParticipantPhotosFolder,
  listParticipantPhotos,
  listPeopleClusters,
  saveParticipantPhotoSelection,
  type PhotoOwnerEntity,
} from "./service.ts";

const securityHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

interface PhotoOwner {
  record: any;
  entityName: PhotoOwnerEntity;
}

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
    const owner: PhotoOwner = body.token
      ? await ownerFromAccessLink(base44, body.token)
      : await ownerFromAuthenticatedUser(base44);

    if (body.action === "save" || (body.action === undefined && body.selectedPhotoIds !== undefined)) {
      return Response.json(
        await saveParticipantPhotoSelection(base44, owner.record, body.selectedPhotoIds, fetch, owner.entityName),
        { headers: securityHeaders },
      );
    }
    if (body.action === "people") {
      return Response.json(
        await listPeopleClusters(base44, owner.record),
        { headers: securityHeaders },
      );
    }
    if (body.action === "claim" || body.action === "unclaim") {
      return Response.json(
        await claimFaceCluster(base44, owner.record, body.clusterKey, body.action === "claim", owner.entityName),
        { headers: securityHeaders },
      );
    }
    if (body.action === "export") {
      return Response.json(
        await exportParticipantPhotosFolder(base44, owner.record, fetch, owner.entityName),
        { headers: securityHeaders },
      );
    }
    return Response.json(
      await listParticipantPhotos(base44, owner.record, body),
      { headers: securityHeaders },
    );
  } catch (error) {
    const { message, status } = toPhotoFunctionError(error);
    return Response.json({ error: message }, { status, headers: securityHeaders });
  }
});

async function ownerFromAccessLink(base44: any, token: string): Promise<PhotoOwner> {
  if (token.length > 2048) throw new Error("Access link is invalid");
  const secret = Deno.env.get("ACCESS_LINK_SECRET");
  if (!secret) throw new Error("Access link is invalid");
  const payload = await verifyAccessToken(token, secret);

  const participants = await base44.asServiceRole.entities.Participant.filter({ access_key: payload.accessKey }, undefined, 2);
  const participant = participants[0];
  if (
    participants.length === 1 &&
    participant &&
    participant.active !== false &&
    participant.access_enabled !== false &&
    participant.access_version === payload.version
  ) {
    return { record: participant, entityName: "Participant" };
  }

  // Mentor invite links are signed with the same secret; the access key
  // decides which record the token belongs to (mirrors mentor-data).
  const mentors = await base44.asServiceRole.entities.Mentor.filter({ access_key: payload.accessKey }, undefined, 2);
  const mentor = mentors[0];
  if (mentors.length === 1 && mentor && (mentor.access_version || 1) === payload.version) {
    return { record: mentor, entityName: "Mentor" };
  }
  throw new Error("Access link is invalid");
}

async function ownerFromAuthenticatedUser(base44: any): Promise<PhotoOwner> {
  const user = await base44.auth.me();
  if (!user) throw new Error("Authentication required");
  const email = user.email.trim().toLowerCase();
  const participants = await base44.asServiceRole.entities.Participant.filter({ email }, undefined, 1);
  const participant = participants[0];
  if (participant && participant.active !== false) return { record: participant, entityName: "Participant" };

  // Signed-in emails that are not on the participant list may belong to a
  // mentor; admin-entered mentor emails carry mixed casing, so match in code.
  const mentors = await base44.asServiceRole.entities.Mentor.list("display_name", 1000);
  const mentor = mentors.find((candidate: any) =>
    typeof candidate.email === "string" && candidate.email.trim().toLowerCase() === email
  );
  if (mentor) return { record: mentor, entityName: "Mentor" };
  throw new Error("Participant access unavailable");
}
