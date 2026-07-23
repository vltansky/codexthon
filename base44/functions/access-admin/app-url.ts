export function appUrl(): string {
  const configuredUrl = Deno.env.get("APP_URL")?.trim() ?? "";
  const parsed = new URL(configuredUrl);
  if (parsed.protocol !== "https:") throw new Error("App URL must use HTTPS");
  return parsed.origin;
}
