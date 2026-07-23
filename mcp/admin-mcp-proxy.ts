import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

const endpoint = readEndpoint();
const keychainService = "codexthon-admin-mcp";
const token = readToken();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = Promise.resolve();

lines.on("line", (line) => {
  if (!line.trim()) return;
  pending = pending.then(() => forward(line)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Admin MCP proxy failed"}\n`);
  });
});

async function forward(line: string): Promise<void> {
  const message = JSON.parse(line) as { id?: string | number | null };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: line,
  });
  if (response.status === 202 || message.id === undefined) {
    await response.body?.cancel();
    return;
  }
  if (!response.ok) {
    const detail = await response.text();
    write({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32000, message: `Admin MCP HTTP ${response.status}: ${detail}` } });
    return;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    write({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: `Unexpected Admin MCP response type: ${contentType}` } });
    return;
  }
  write(await response.json());
}

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function readToken(): string {
  try {
    return execFileSync("security", ["find-generic-password", "-a", process.env.USER ?? "", "-s", keychainService, "-w"], { encoding: "utf8" }).trim();
  } catch {
    process.stderr.write(`Missing Keychain credential: ${keychainService}\n`);
    process.exit(1);
  }
}

function readEndpoint(): string {
  const value = process.env.ADMIN_MCP_ENDPOINT?.trim() ?? "";
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.pathname.endsWith("/functions/admin-mcp")) {
    throw new Error("ADMIN_MCP_ENDPOINT must be an HTTPS admin MCP function URL");
  }
  return url.href;
}
