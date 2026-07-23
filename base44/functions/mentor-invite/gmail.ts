interface ConnectorsModule {
  getConnection(type: string): Promise<{ accessToken: string }>;
}

interface SendGmailAccessEmailInput {
  connectors: ConnectorsModule;
  fetcher: typeof fetch;
  to: string;
  subject: string;
  html: string;
}

export async function sendGmailAccessEmail(input: SendGmailAccessEmailInput): Promise<string> {
  const { accessToken } = await input.connectors.getConnection("gmail");
  const message = [
    `To: ${safeHeader(input.to)}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.html,
  ].join("\r\n");
  const response = await input.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64UrlEncode(message) }),
  });
  if (!response.ok) throw new Error(`Gmail rejected the message (${response.status})`);
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error("Gmail did not return a message ID");
  return result.id;
}

function safeHeader(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Email headers contain invalid characters");
  return value;
}

function encodeHeader(value: string): string {
  safeHeader(value);
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64Encode(value)}?=`;
}

function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlEncode(value: string): string {
  return base64Encode(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
