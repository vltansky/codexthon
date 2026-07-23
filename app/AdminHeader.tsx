import { base44 } from "./base44Client";
import type { AppUser } from "./types";

export type AdminPage = "desk" | "mentors" | "judging" | "teams" | "codes" | "content";

export function AdminHeader({
  activePage,
  user,
  onNavigate,
}: {
  activePage: AdminPage;
  user: AppUser;
  onNavigate: (page: AdminPage) => void;
}) {
  return (
    <>
      <header className="app-header">
        <div><p className="eyebrow">Codex Build Week</p><h1>{pageTitle(activePage)}</h1></div>
        <div className="admin-identity"><span>{user.email}</span><button className="text-button" onClick={() => base44.auth.logout(window.location.origin)}>Sign out</button></div>
      </header>
      <nav className="admin-nav" aria-label="Admin pages">
        <button aria-current={activePage === "desk" ? "page" : undefined} onClick={() => onNavigate("desk")}>Admin</button>
        <button aria-current={activePage === "mentors" ? "page" : undefined} onClick={() => onNavigate("mentors")}>Mentors</button>
        <button aria-current={activePage === "judging" ? "page" : undefined} onClick={() => onNavigate("judging")}>Judging</button>
        <button aria-current={activePage === "teams" ? "page" : undefined} onClick={() => onNavigate("teams")}>Teams</button>
        <button aria-current={activePage === "codes" ? "page" : undefined} onClick={() => onNavigate("codes")}>Codes</button>
        <button aria-current={activePage === "content" ? "page" : undefined} onClick={() => onNavigate("content")}>Content</button>
      </nav>
    </>
  );
}

function pageTitle(page: AdminPage) {
  if (page === "mentors") return "Mentors";
  if (page === "judging") return "Judging";
  if (page === "teams") return "Teams";
  if (page === "codes") return "Promo codes";
  if (page === "content") return "Event content";
  return "Hackathon desk";
}
