import { createClientFromRequest } from "npm:@base44/sdk";
import { handleAdminMcpProtocolRequest } from "./server.ts";
import { hasValidBearerToken } from "./auth.ts";

const privateHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

Deno.serve(async (request) => {
  const secret = Deno.env.get("ADMIN_MCP_TOKEN");
  if (!secret) return Response.json({ error: "Admin MCP is not configured" }, { status: 503, headers: privateHeaders });
  if (!await hasValidBearerToken(request, secret)) {
    return Response.json({ error: "Unauthorized" }, {
      status: 401,
      headers: { ...privateHeaders, "WWW-Authenticate": "Bearer" },
    });
  }

  const base44 = createClientFromRequest(request);
  const response = await handleAdminMcpProtocolRequest(base44.asServiceRole, request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
