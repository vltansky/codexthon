import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";

import { base44 } from "./base44Client";
import { internalLinkHandler } from "./navigation";
import type { JudgePortalData } from "./types";
import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { photosPagePath } from "../src/photo-gallery";

export function JudgeDashboard({ fallbackError, accessToken, onExit }: { fallbackError?: string; accessToken?: string; onExit?: () => void }) {
  const [data, setData] = useState<JudgePortalData | null>(null);
  const [error, setError] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState("");
  const emailDialogRef = useRef<HTMLDialogElement | null>(null);
  const exit = onExit ?? (() => base44.auth.logout(window.location.origin));
  const needsEmail = Boolean(accessToken && data && !data.judge.email);

  useEffect(() => {
    // Judge data is permission-filtered by the authenticated Base44 function.
    void loadJudgePortal();
  }, []);

  useEffect(() => {
    // Native modal dialogs only open imperatively via showModal.
    const dialog = emailDialogRef.current;
    if (needsEmail && dialog && !dialog.open) dialog.showModal();
    if (!needsEmail && dialog?.open) dialog.close();
  }, [needsEmail]);

  async function loadJudgePortal() {
    setError("");
    try {
      setData(unwrapBase44FunctionResponse<JudgePortalData>(await base44.functions.invoke("judge-data", accessToken ? { token: accessToken } : {})));
    } catch (caught) {
      setError(fallbackError ?? (caught instanceof Error ? caught.message : "Could not load your judge details"));
    }
  }

  async function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setSavingEmail(true);
    setEmailError("");
    try {
      setData(unwrapBase44FunctionResponse<JudgePortalData>(await base44.functions.invoke("judge-data", { token: accessToken, action: "set-email", email })));
    } catch (caught) {
      setEmailError(caught instanceof Error ? caught.message : "Could not save your email");
    } finally {
      setSavingEmail(false);
    }
  }

  if (error) {
    return (
      <main className="centered-state">
        <p className="eyebrow">Access unavailable</p>
        <h1>We couldn’t match your registration.</h1>
        <p>{error}</p>
        <button className="secondary-button" onClick={exit}>Sign out</button>
      </main>
    );
  }

  if (!data) {
    return <main className="centered-state"><p>Loading your judging panels…</p></main>;
  }

  const firstName = data.judge.displayName.split(" ")[0];

  return (
    <main className="participant-shell">
      <header className="portal-nav">
        <div className="portal-wordmark"><span>BUILD WEEK · TEL AVIV</span></div>
        <button className="text-button" onClick={exit}>Sign out</button>
      </header>

      <section className="mentor-hero">
        <p className="eyebrow">Judge portal</p>
        <h1>Welcome, {firstName}.</h1>
        <p>{data.groups.length ? `You are judging in ${data.groups.length} panel${data.groups.length === 1 ? "" : "s"} tonight.` : "No judging panels are assigned to you yet. Check back after panels are published."}</p>
        <div className="mentor-links">
          <a href={photosPagePath("all")} onClick={internalLinkHandler(photosPagePath("all"))}>Browse event photos <ArrowRight size={14} aria-hidden="true" /></a>
          <a href={photosPagePath("people")} onClick={internalLinkHandler(photosPagePath("people"))}>Find your face <ArrowRight size={14} aria-hidden="true" /></a>
          <a href={photosPagePath("mine")} onClick={internalLinkHandler(photosPagePath("mine"))}>My photos <ArrowRight size={14} aria-hidden="true" /></a>
        </div>
      </section>

      {data.groups.map((group) => (
        <section className="judge-group" key={group.groupKey}>
          <div className="mentor-hero judge-group-heading">
            <p className="section-kicker">{group.teams.length} team{group.teams.length === 1 ? "" : "s"}</p>
            <h2>{group.name}</h2>
            {group.details && <p>{group.details}</p>}
            {group.panel.length > 0 && <p>Judging with {group.panel.join(", ")}</p>}
          </div>
          <div className="mentor-teams-grid">
            {group.teams.map((team) => {
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
        </section>
      ))}

      <dialog className="mentor-onboard-dialog" ref={emailDialogRef} onCancel={(event) => event.preventDefault()} aria-labelledby="judge-onboard-title">
        <form onSubmit={(event) => void saveEmail(event)}>
          <p className="eyebrow">One quick thing</p>
          <h2 id="judge-onboard-title">Add your email</h2>
          <p>It keeps your judge access if you lose this link or switch devices.</p>
          <label>Email<input name="email" type="email" required autoFocus placeholder="you@example.com" disabled={savingEmail} /></label>
          {emailError && <p className="mentor-onboard-error" role="alert">{emailError}</p>}
          <button className="primary-button" disabled={savingEmail}>{savingEmail ? "Saving…" : "Save email"}</button>
        </form>
      </dialog>
    </main>
  );
}
