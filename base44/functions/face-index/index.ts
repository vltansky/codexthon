import { createClientFromRequest } from "npm:@base44/sdk";

import { indexStatus, resetIndex, runIndexBatch } from "./indexer.ts";

const securityHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

Deno.serve(async (request) => {
  try {
    const base44 = createClientFromRequest(request);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Admin access required" }, { status: 403, headers: securityHeaders });
    }

    const body = await request.json() as { action?: unknown; batchSize?: unknown };
    if (body.action === "diag") return Response.json(await runtimeDiagnostics(), { headers: securityHeaders });
    if (body.action === "run") {
      return Response.json(await runIndexBatch(base44, body.batchSize), { headers: securityHeaders });
    }
    if (body.action === "reset") {
      return Response.json(await resetIndex(base44), { headers: securityHeaders });
    }
    return Response.json(await indexStatus(base44), { headers: securityHeaders });
  } catch (error) {
    console.error(`face-index: ${error}`);
    // Admin-only function: returning the failure detail aids operability.
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    return Response.json({ error: `Face indexing failed: ${detail.slice(0, 900)}` }, { status: 500, headers: securityHeaders });
  }
});

async function runtimeDiagnostics(): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  try {
    await import(`data:text/javascript;base64,${btoa("export default 1")}`);
    results.dataImport = "ok";
  } catch (error) {
    results.dataImport = String(error);
  }
  results.metaUrl = String(import.meta.url);
  try {
    results.urlFromMeta = new URL("x.mjs", import.meta.url).href;
  } catch (error) {
    results.urlFromMeta = String(error);
  }
  try {
    const response = await fetch("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.wasm", { method: "HEAD" });
    results.cdnStatus = String(response.status);
  } catch (error) {
    results.cdnStatus = String(error);
  }
  results.webAssembly = typeof WebAssembly?.instantiate;
  results.locationHref = String(globalThis.location?.href);
  return results;
}
