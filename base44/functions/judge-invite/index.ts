import { createClientFromRequest } from "npm:@base44/sdk";

import { appUrl } from "./app-url.ts";
import { signAccessToken } from "./access-link.ts";

const defaultExpiry = "2026-08-01T21:00:00.000Z";
const privateResponse = { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } };

Deno.serve(async (request) => {
  try {
    const base44 = createClientFromRequest(request);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") return Response.json({ error: "Admin access required" }, { status: 403 });
    const secret = Deno.env.get("ACCESS_LINK_SECRET");
    if (!secret) return Response.json({ error: "Access links are not configured" }, { status: 503 });

    const body = await request.json() as Record<string, unknown>;
    const judgeId = typeof body.judgeId === "string" ? body.judgeId : "";
    const judge = judgeId ? await base44.asServiceRole.entities.Judge.get(judgeId).catch(() => null) : null;
    if (!judge) return Response.json({ error: "Judge not found" }, { status: 404 });

    const data = {
      access_key: judge.access_key || crypto.randomUUID(),
      access_version: judge.access_version || 1,
      access_expires_at: judge.access_expires_at || defaultExpiry,
      invited_at: new Date().toISOString(),
    };
    await base44.asServiceRole.entities.Judge.update(judgeId, data);
    const token = await signAccessToken({
      accessKey: data.access_key,
      version: data.access_version,
      expiresAt: data.access_expires_at,
    }, secret);
    return Response.json({ judgeId, url: `${appUrl()}/#judge=${encodeURIComponent(token)}` }, privateResponse);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create the judge link" },
      { status: 500 },
    );
  }
});
