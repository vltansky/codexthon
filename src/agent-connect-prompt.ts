export interface AgentConnectInput {
  endpoint: string;
  token: string;
}

export interface ManualInstallStep {
  label: string;
  hint: string;
  value: string;
}

export function buildManualInstallSteps({ endpoint, token }: AgentConnectInput): ManualInstallStep[] {
  const url = endpoint.trim();
  const key = token.trim();
  if (!url || !key) return [];
  return [
    { label: "Server URL", hint: "Streamable HTTP MCP", value: url },
    { label: "Personal event key", hint: "send as Authorization: Bearer", value: key },
    {
      label: "Codex",
      hint: "keeps the key in your shell, not in config",
      value: `export BUILD_WEEK_KEY="${key}"\ncodex mcp add build-week --url ${url} --bearer-token-env-var BUILD_WEEK_KEY`,
    },
    {
      label: "Any other client",
      hint: "drop into your MCP config file",
      value: JSON.stringify({ mcpServers: { "build-week": { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    },
  ];
}

// Screens get shared at hackathons; show a stub, copy the real value.
export function maskEventKey(value: string, token: string): string {
  const key = token.trim();
  if (!key) return value;
  return value.replaceAll(key, `${key.slice(0, 8)}…`);
}

// The participant pastes this into their own coding agent, which then installs
// the event MCP server for whichever CLI they happen to be running.
export function buildAgentConnectPrompt({ endpoint, token }: AgentConnectInput): string {
  if (!endpoint.trim() || !token.trim()) return "";
  return [
    "Connect me to the Build Week event MCP server so you can answer questions about this event.",
    "",
    "Server name: build-week",
    `URL (Streamable HTTP MCP): ${endpoint.trim()}`,
    `My personal event key: ${token.trim()}`,
    "Auth: send it as the header `Authorization: Bearer <key>`.",
    "",
    `In Codex: set BUILD_WEEK_KEY to my key in my shell profile, then run \`codex mcp add build-week --url ${endpoint.trim()} --bearer-token-env-var BUILD_WEEK_KEY\`.`,
    "In any other client: add a Streamable HTTP MCP server with that URL and Authorization header.",
    "",
    "The key is personal: keep it out of git, and do not paste it into chats or issues.",
    "Then reload your MCP servers, call the event_my_status tool, and tell me my team, my mentor, and the Wi-Fi.",
  ].join("\n");
}
