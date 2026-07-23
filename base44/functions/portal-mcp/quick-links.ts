export interface EventQuickLink {
  label: string;
  detail: string;
  href: string;
}

export const eventQuickLinks: EventQuickLink[] = [
  { label: "Base44 backend", detail: "Build and deploy your backend", href: "https://base44.com/backend" },
  { label: "Switch to Codex", detail: "Using Claude, Cursor, or something else? We’ve got your back — import in one click", href: "https://chatgpt.com/codex/switch-to-codex/" },
  { label: "Chrome extension", detail: "Let Codex use your real browser, including auth", href: "https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg?hl=en" },
];
