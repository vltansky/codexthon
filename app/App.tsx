import { useEffect, useState, useSyncExternalStore } from "react";

import { AdminContentPage } from "./AdminContentPage";
import { AdminCodesPage } from "./AdminCodesPage";
import { AdminFacesPage } from "./AdminFacesPage";
import { AdminDashboard } from "./AdminDashboard";
import type { AdminPage } from "./AdminHeader";
import { AdminJudgingPage } from "./AdminJudgingPage";
import { AdminMentorsPage } from "./AdminMentorsPage";
import { AdminParticipantPage } from "./AdminParticipantPage";
import { AdminTeamPage } from "./AdminTeamPage";
import { AdminTeamsPage } from "./AdminTeamsPage";
import { base44 } from "./base44Client";
import { LoginScreen } from "./LoginScreen";
import { navigateTo } from "./navigation";
import { participantAnalytics } from "./participantAnalytics";
import { ParticipantDashboard } from "./ParticipantDashboard";
import { ParticipantPhotosPage } from "./ParticipantPhotosPage";
import type { AppUser } from "./types";
import { MentorDashboard } from "./MentorDashboard";
import { accessTokenFromHash, mentorTokenFromHash } from "../src/access-session";
import { parsePhotosRoute } from "../src/photo-gallery";

const accessSessionKey = "codex-hackathon-access";
const mentorSessionKey = "codex-hackathon-mentor-access";

export function App() {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [accessToken, setAccessToken] = useState<string | null>(() => isLocalPreview() ? null : consumeAccessToken());
  const [mentorToken, setMentorToken] = useState<string | null>(() => isLocalPreview() ? null : consumeMentorToken());
  const location = useSyncExternalStore(subscribeToNavigation, () => `${window.location.pathname}${window.location.search}`);
  const [pathname = "/", search = ""] = location.split(/(?=\?)/);
  const photosRoute = parsePhotosRoute(pathname, search);
  const localPreview = isLocalPreview();
  const participantAccessMode = accessToken ? "signed_link" : user?.role === "user" ? "authenticated" : null;

  useEffect(() => {
    // Authentication is persisted by Base44 and must be resolved after page load.
    if (!accessToken && !mentorToken && !localPreview) void resolveUser();
  }, [accessToken, mentorToken, localPreview]);

  useEffect(() => {
    // Personal links navigate by fragment, so same-tab link changes do not reload the app.
    const controller = new AbortController();
    window.addEventListener("hashchange", () => {
      setAccessToken(localPreview ? null : consumeAccessToken());
      setMentorToken(localPreview ? null : consumeMentorToken());
    }, { signal: controller.signal });
    return () => controller.abort();
  }, [localPreview]);

  useEffect(() => {
    // Analytics must observe client-side route changes after participant access resolves.
    if (localPreview || !participantAccessMode) return;
    if (photosRoute) {
      participantAnalytics.pageViewed({
        page: "photos",
        accessMode: participantAccessMode,
        view: photosRoute.view,
        pageNumber: photosRoute.page,
      });
      return;
    }
    if (pathname === "/") participantAnalytics.pageViewed({ page: "portal", accessMode: participantAccessMode });
  }, [localPreview, participantAccessMode, pathname, photosRoute?.page, photosRoute?.view]);

  async function resolveUser() {
    try {
      setUser((await base44.auth.me()) as AppUser);
    } catch {
      setUser(null);
    }
  }

  if (accessToken) {
    if (photosRoute) return <ParticipantPhotosPage accessToken={accessToken} view={photosRoute.view} page={photosRoute.page} clusterKey={photosRoute.clusterKey} />;
    return <ParticipantDashboard accessToken={accessToken} onExit={() => {
      sessionStorage.removeItem(accessSessionKey);
      setAccessToken(null);
    }} />;
  }
  if (mentorToken) {
    return <MentorDashboard accessToken={mentorToken} onExit={() => {
      sessionStorage.removeItem(mentorSessionKey);
      setMentorToken(null);
    }} />;
  }
  if (localPreview) {
    if (photosRoute) return <ParticipantPhotosPage preview view={photosRoute.view} page={photosRoute.page} clusterKey={photosRoute.clusterKey} />;
    return <ParticipantDashboard preview />;
  }
  if (user === undefined) return <main className="centered-state"><p>Opening the event portal…</p></main>;
  if (user === null) return <LoginScreen />;
  if (user.role === "admin") {
    const teamKey = adminTeamKeyFromPath(pathname);
    if (teamKey) return <AdminTeamPage user={user} teamKey={teamKey} onNavigate={navigateAdmin} />;
    const participantId = adminParticipantIdFromPath(pathname);
    if (participantId) return <AdminParticipantPage user={user} participantId={participantId} onNavigate={navigateAdmin} />;
    const activePage = adminPageFromPath(pathname);
    if (activePage === "mentors") return <AdminMentorsPage user={user} onNavigate={navigateAdmin} />;
    if (activePage === "judging") return <AdminJudgingPage user={user} onNavigate={navigateAdmin} />;
    if (activePage === "teams") return <AdminTeamsPage user={user} onNavigate={navigateAdmin} />;
    if (activePage === "content") return <AdminContentPage user={user} onNavigate={navigateAdmin} />;
    if (activePage === "codes") return <AdminCodesPage user={user} onNavigate={navigateAdmin} />;
    if (activePage === "faces") return <AdminFacesPage user={user} onNavigate={navigateAdmin} />;
    return <AdminDashboard user={user} onNavigate={navigateAdmin} />;
  }
  if (photosRoute) return <ParticipantPhotosPage view={photosRoute.view} page={photosRoute.page} clusterKey={photosRoute.clusterKey} />;
  return <ParticipantDashboard />;
}

function isLocalPreview() {
  return import.meta.env.DEV && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
}

function navigateAdmin(page: AdminPage) {
  navigateTo(page === "desk" ? "/admin" : `/admin/${page}`);
}

function adminTeamKeyFromPath(pathname: string): string | null {
  const match = /^\/admin\/teams\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

function adminParticipantIdFromPath(pathname: string): string | null {
  const match = /^\/admin\/participants\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

function adminPageFromPath(pathname: string): AdminPage {
  if (pathname === "/admin/mentors") return "mentors";
  if (pathname === "/admin/judging") return "judging";
  if (pathname === "/admin/teams") return "teams";
  if (pathname === "/admin/codes") return "codes";
  if (pathname === "/admin/content") return "content";
  if (pathname === "/admin/faces") return "faces";
  return "desk";
}

function subscribeToNavigation(onChange: () => void) {
  const controller = new AbortController();
  window.addEventListener("popstate", onChange, { signal: controller.signal });
  window.addEventListener("app:navigate", onChange, { signal: controller.signal });
  return () => controller.abort();
}

function consumeAccessToken(): string | null {
  const token = accessTokenFromHash(window.location.hash);
  if (!token) return sessionStorage.getItem(accessSessionKey);
  sessionStorage.setItem(accessSessionKey, token);
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token;
}

function consumeMentorToken(): string | null {
  const token = mentorTokenFromHash(window.location.hash);
  if (!token) return sessionStorage.getItem(mentorSessionKey);
  sessionStorage.setItem(mentorSessionKey, token);
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token;
}
