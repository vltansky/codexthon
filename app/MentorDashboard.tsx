import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { base44 } from "./base44Client";
import { internalLinkHandler } from "./navigation";
import type { MentorPortalData } from "./types";
import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { photosPagePath } from "../src/photo-gallery";

export function MentorDashboard({ fallbackError }: { fallbackError?: string }) {
  const [data, setData] = useState<MentorPortalData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // Mentor data is permission-filtered by the authenticated Base44 function.
    void loadMentorPortal();
  }, []);

  async function loadMentorPortal() {
    setError("");
    try {
      setData(unwrapBase44FunctionResponse<MentorPortalData>(await base44.functions.invoke("mentor-data", {})));
    } catch (caught) {
      setError(fallbackError ?? (caught instanceof Error ? caught.message : "Could not load your mentor details"));
    }
  }

  if (error) {
    return (
      <main className="centered-state">
        <p className="eyebrow">Access unavailable</p>
        <h1>We couldn’t match your registration.</h1>
        <p>{error}</p>
        <button className="secondary-button" onClick={() => base44.auth.logout(window.location.origin)}>Sign out</button>
      </main>
    );
  }

  if (!data) {
    return <main className="centered-state"><p>Loading your teams…</p></main>;
  }

  const firstName = data.mentor.displayName.split(" ")[0];

  return (
    <main className="participant-shell">
      <header className="portal-nav">
        <div className="portal-wordmark"><span>BUILD WEEK · TEL AVIV</span></div>
        <button className="text-button" onClick={() => base44.auth.logout(window.location.origin)}>Sign out</button>
      </header>

      <section className="mentor-hero">
        <p className="eyebrow">Mentor portal</p>
        <h1>Welcome, {firstName}.</h1>
        <p>{data.teams.length ? `You are mentoring ${data.teams.length} team${data.teams.length === 1 ? "" : "s"} tonight.` : "No teams are assigned to you yet. Check back after assignments are published."}</p>
        <div className="mentor-links">
          <a href={photosPagePath("all")} onClick={internalLinkHandler(photosPagePath("all"))}>Browse event photos <ArrowRight size={14} aria-hidden="true" /></a>
          <a href={photosPagePath("people")} onClick={internalLinkHandler(photosPagePath("people"))}>Find your face <ArrowRight size={14} aria-hidden="true" /></a>
          <a href={photosPagePath("mine")} onClick={internalLinkHandler(photosPagePath("mine"))}>My photos <ArrowRight size={14} aria-hidden="true" /></a>
        </div>
      </section>

      <div className="mentor-teams-grid">
        {data.teams.map((team) => {
          const checkedInMembers = team.members.filter(({ checkedIn }) => checkedIn).length;
          return (
            <section className="team-section" key={team.teamKey}>
              <p className="section-kicker">{checkedInMembers}/{team.members.length} checked in</p>
              <h2>{team.teamName}</h2>
              <div className="member-list">
                {team.members.map((member) => (
                  <div className="member-row" key={member.displayName}>
                    <span>{member.displayName}</span>
                    {member.checkedIn ? <small>Checked in</small> : null}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
