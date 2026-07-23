import { createClientFromRequest } from "npm:@base44/sdk";

import { indexStatus, ingestPhoto, listClusters, pendingPhotos, proxyThumbnail, resetIndex } from "./indexer.ts";

const securityHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

Deno.serve(async (request) => {
  try {
    const base44 = createClientFromRequest(request);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Admin access required" }, { status: 403, headers: securityHeaders });
    }

    const body = await request.json() as { action?: unknown; photoId?: unknown; photoName?: unknown; faces?: unknown };
    if (body.action === "pending") {
      return Response.json(await pendingPhotos(base44), { headers: securityHeaders });
    }
    if (body.action === "thumbnail") {
      return Response.json(await proxyThumbnail(base44, body.photoId), { headers: securityHeaders });
    }
    if (body.action === "ingest") {
      return Response.json(await ingestPhoto(base44, body), { headers: securityHeaders });
    }
    if (body.action === "clusters") {
      return Response.json(await listClusters(base44), { headers: securityHeaders });
    }
    if (body.action === "reset") {
      return Response.json(await resetIndex(base44), { headers: securityHeaders });
    }
    return Response.json(await indexStatus(base44), { headers: securityHeaders });
  } catch (error) {
    console.error(`face-index: ${error}`);
    // Admin-only function: returning the failure detail aids operability.
    return Response.json({ error: `Face indexing failed: ${String(error)}` }, { status: 500, headers: securityHeaders });
  }
});
