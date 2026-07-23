import { useEffect, useState } from "react";
import { ArrowRight, BriefcaseBusiness, Check, Copy, Mail, MapPin, MessageCircle } from "lucide-react";

import { base44 } from "./base44Client";
import { MentorDashboard } from "./MentorDashboard";
import { internalLinkHandler } from "./navigation";
import { participantAnalytics } from "./participantAnalytics";
import { defaultPromoInstructions } from "./promo-instructions";
import type { AppUser, PortalData } from "./types";
import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { buildAgentConnectPrompt, buildManualInstallSteps, maskEventKey } from "../src/agent-connect-prompt";
import { buildCategories } from "../src/build-categories";
import { defaultQuestionsAndAnswers } from "../src/default-questions-and-answers";
import { eventQuickLinks } from "../src/event-quick-links";
import { photosPagePath } from "../src/photo-gallery";
import type { ParticipantAnalyticsArea, ParticipantAnalyticsTarget } from "../src/participant-analytics";
import { parseQuestionsAndAnswers } from "../src/questions-and-answers";
import "./participant-photos.css";

const agendaGroupLabels = new Set(["START", "JUDGING", "FINALS"]);
const manualInstallTargets = new Map<string, ParticipantAnalyticsTarget>([
  ["Server URL", "server_url"],
  ["Personal event key", "personal_key"],
  ["Codex", "codex_command"],
  ["Any other client", "client_config"],
]);
const fallbackAgenda = [
  "START",
  "17:00 — Doors + check-in",
  "17:30 — Kickoff",
  "18:00 — Build sprint",
  "21:00 — Pizza",
  "JUDGING",
  "22:00 — Build ends",
  "Judges visit every team at its table",
  "FINALS",
  "23:00 — Top 5 stage demos",
  "23:30 — Winners + closing",
].join("\n");

function formatQuestionAnswer(answer: string) {
  const parts = answer.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const markdownLink = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (markdownLink) return <a key={index} href={markdownLink[2]} target="_blank" rel="noreferrer">{markdownLink[1]}</a>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

export function ParticipantDashboard({ user, accessToken, onExit, preview = false }: { user?: AppUser; accessToken?: string; onExit?: () => void; preview?: boolean }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState("");
  const [copiedPromo, setCopiedPromo] = useState<"codex" | "api" | "base44" | null>(null);
  const [copiedWifi, setCopiedWifi] = useState<string | null>(null);
  const [copiedConnectPrompt, setCopiedConnectPrompt] = useState(false);
  const [copiedManualStep, setCopiedManualStep] = useState<string | null>(null);

  useEffect(() => {
    // Portal data is permission-filtered by the authenticated Base44 function.
    if (preview) {
      setData(localPreviewData);
      return;
    }
    void loadPortal();
  }, [accessToken, preview]);

  async function loadPortal() {
    setError("");
    try {
      setData(unwrapBase44FunctionResponse<PortalData>(
        await base44.functions.invoke(accessToken ? "access-portal" : "portal-data", accessToken ? { token: accessToken } : {}),
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your event details");
    }
  }

  if (error) {
    // Signed-in emails that are not on the participant list may belong to a mentor.
    if (!accessToken) return <MentorDashboard fallbackError={error} />;
    return (
      <main className="centered-state">
        <p className="eyebrow">Access unavailable</p>
        <h1>We couldn’t match your registration.</h1>
        <p>{error}</p>
        <button className="secondary-button" onClick={() => accessToken ? onExit?.() : base44.auth.logout(window.location.origin)}>
          {accessToken ? "Use another access method" : "Sign out"}
        </button>
      </main>
    );
  }

  if (!data) {
    return <main className="centered-state"><p>Loading your team…</p></main>;
  }

  const settings = data.settings ?? {
    eventName: "Community event",
    eventUrl: "",
    wifiNetwork: "",
    wifiPassword: "",
    wifiNetworkSecondary: "",
    wifiPasswordSecondary: "",
    eventDetails: "Event details will be published shortly.",
    agenda: fallbackAgenda,
    questionsAndAnswers: defaultQuestionsAndAnswers,
    promoInstructions: defaultPromoInstructions,
    partnerCouponCode: "",
    partnerRegistrationUrl: "",
  };
  const eventUrl = settings.eventUrl.trim();
  const wifiNetwork = settings.wifiNetwork.trim();
  const wifiPassword = settings.wifiPassword.trim();
  const wifiConnections = [
    { network: wifiNetwork, password: wifiPassword },
    { network: settings.wifiNetworkSecondary.trim(), password: settings.wifiPasswordSecondary.trim() },
  ].filter(({ network }) => network);
  const agenda = settings.agenda.trim() || fallbackAgenda;
  const questionsAndAnswers = parseQuestionsAndAnswers(settings.questionsAndAnswers.trim() || defaultQuestionsAndAnswers)
    .filter(({ question, answer }) => question.trim() && answer.trim());
  const promoInstructions = settings.promoInstructions.trim() || defaultPromoInstructions;
  const eventKey = accessToken ?? data.mcpToken ?? "";
  const connectInput = { endpoint: `${window.location.origin}/functions/portal-mcp`, token: eventKey };
  const connectPrompt = buildAgentConnectPrompt(connectInput);
  const manualInstallSteps = buildManualInstallSteps(connectInput);
  const firstName = data.participant.displayName.split(" ")[0];
  const checkedInTeamMembers = data.teamMembers.filter((member) => member.checkedIn).length;

  async function copyPromoLink(kind: "codex" | "api" | "base44", value: string) {
    await copyParticipantValue(value, "promo", kind, () => {
      setCopiedPromo(kind);
      if (kind !== "base44") reportPromoClaim();
    });
  }

  function reportPromoClaim() {
    if (preview) return;
    void base44.functions.invoke(
      accessToken ? "access-portal" : "portal-data",
      accessToken ? { token: accessToken, action: "promo-claimed" } : { action: "promo-claimed" },
    ).catch(() => {});
  }

  async function copyWifi(kind: string, target: "network" | "password", value: string) {
    await copyParticipantValue(value, "wifi", target, () => setCopiedWifi(kind));
  }

  async function copyConnectPrompt() {
    await copyParticipantValue(connectPrompt, "agent_setup", "install_prompt", () => {
      setCopiedConnectPrompt(true);
      setCopiedManualStep(null);
    });
  }

  async function copyManualStep(label: string, value: string) {
    const target = manualInstallTargets.get(label) ?? "manual_step";
    await copyParticipantValue(value, "agent_setup", target, () => {
      setCopiedManualStep(label);
      setCopiedConnectPrompt(false);
    });
  }

  async function copyParticipantValue(
    value: string,
    area: ParticipantAnalyticsArea,
    target: ParticipantAnalyticsTarget,
    onCopied: () => void,
  ) {
    try {
      await navigator.clipboard.writeText(value);
      onCopied();
      if (!preview) participantAnalytics.actionCompleted({ area, action: "copy_succeeded", target });
    } catch {
      if (!preview) participantAnalytics.actionFailed({ area, action: "copy", errorCategory: "clipboard_unavailable", target });
    }
  }

  function trackPromoApply(kind: "codex" | "api") {
    if (!preview) participantAnalytics.actionCompleted({ area: "promo", action: "apply_clicked", target: kind });
    reportPromoClaim();
  }

  return (
    <main className={`participant-shell ${data.participant.checkedIn ? "portal-unlocked" : "portal-waiting"}`}>
      <header className="portal-nav">
        <div className="portal-wordmark">
          <a className="portal-logo" href="https://openai.com/build-week/" target="_blank" rel="noreferrer" aria-label="OpenAI Build Week">
            <svg width="90" fill="none" viewBox="0 0 288 78" aria-hidden="true">
              <path fill="currentColor" d="M30.6.398C13.77.398 0 14.168 0 30.998s13.77 30.6 30.6 30.6 30.6-13.685 30.6-30.6S47.515.398 30.6.398m0 50.235c-10.455 0-18.87-8.585-18.87-19.635s8.415-19.635 18.87-19.635 18.87 8.585 18.87 19.635-8.415 19.635-18.87 19.635m61.54-33.235c-5.526 0-10.88 2.21-13.686 5.95v-5.1h-11.05v59.5h11.05V56.243c2.805 3.485 7.99 5.355 13.685 5.355 11.9 0 21.25-9.35 21.25-22.1s-9.35-22.1-21.25-22.1m-1.87 34.595c-6.29 0-11.9-4.93-11.9-12.495s5.61-12.495 11.9-12.495 11.899 4.93 11.899 12.495-5.61 12.495-11.9 12.495m49.133-34.595c-12.07 0-21.59 9.435-21.59 22.1s8.33 22.1 21.93 22.1c11.135 0 18.275-6.715 20.485-14.28h-10.795c-1.36 3.145-5.185 5.355-9.775 5.355-5.695 0-10.03-3.995-11.05-9.69h32.13v-4.335c0-11.56-8.075-21.25-21.335-21.25m-10.71 17.765c1.19-5.355 5.61-8.84 10.965-8.84 5.695 0 10.03 3.74 10.54 8.84zm61.454-17.765c-4.93 0-10.115 2.21-12.495 5.865v-5.015H166.6v42.5h11.05V37.883c0-6.63 3.57-10.965 9.35-10.965 5.355 0 8.245 4.08 8.245 9.775v24.055h11.05v-25.84c0-10.54-6.46-17.51-16.15-17.51M234.596 1.25l-24.055 59.5h11.815l5.1-13.005h27.37l5.1 13.005h11.985l-23.885-59.5zm-3.315 36.635 9.86-24.905 9.775 24.905zM287.636 1.25h-11.22v59.5h11.22z" />
            </svg>
          </a>
          <span>BUILD WEEK · TEL AVIV</span>
        </div>
        {preview ? <span className="preview-label">Local preview</span> : <button className="text-button" onClick={() => accessToken ? onExit?.() : base44.auth.logout(window.location.origin)}>{accessToken ? "Exit personal link" : "Sign out"}</button>}
      </header>

      <section className="portal-hero">
        <img className="portal-hero-art" src="/build-week-earth.jpg" alt="" />
        <div className="portal-hero-copy">
          <p className="eyebrow">{data.participant.checkedIn ? "Checked in" : "Awaiting check-in"}</p>
          <h1>{data.participant.checkedIn ? `${firstName}, you’re in.` : `Welcome, ${firstName}.`}</h1>
          <p>{data.participant.checkedIn ? "Your personal build credit is ready." : "Check in to unlock your personal build credit."}</p>
          <div className="portal-hero-actions">
            {eventUrl ? <a className="portal-link-primary" href={eventUrl} target="_blank" rel="noreferrer">Event details ↗</a> : null}
            <button className="portal-link-secondary" onClick={() => void loadPortal()}>Refresh status</button>
          </div>
        </div>
        <div className="portal-status-mark" aria-label={`${checkedInTeamMembers} of ${data.teamMembers.length} team members checked in`}>
          <span>{checkedInTeamMembers}/{data.teamMembers.length}</span>
          <strong>TEAM MEMBERS CHECKED IN</strong>
        </div>
      </section>

      <CreditVault
        checkedIn={data.participant.checkedIn}
        copiedPromo={copiedPromo}
        instructions={promoInstructions}
        promoLinks={data.promoLinks ?? { codexCredits: null, apiCredits: null }}
        partnerCouponCode={settings.partnerCouponCode?.trim() ?? ""}
        partnerRegistrationUrl={settings.partnerRegistrationUrl?.trim() ?? ""}
        onApply={trackPromoApply}
        onCopy={copyPromoLink}
      />

      <div className="participant-grid">
        <section className="team-section">
          <p className="section-kicker">Your team</p>
          <h2>{data.participant.teamName}</h2>
          {data.teamTable ? (
            <p className="team-table-callout">
              <MapPin size={15} aria-hidden="true" />
              {[data.teamTable.tableNumber && `Table ${data.teamTable.tableNumber}`, data.teamTable.note].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <div className="member-list">
            {data.teamMembers.map((member) => (
              <div className="member-row" key={member.displayName}>
                <span>{member.displayName}{member.isCurrentUser ? <small>You</small> : null}</span>
                <span className="member-contacts">
                  {member.phone ? <a href={`tel:${member.phone}`} aria-label={`Call ${member.displayName}`}><MessageCircle size={13} aria-hidden="true" />{member.phone}</a> : null}
                  {member.linkedin ? <a href={member.linkedin} target="_blank" rel="noreferrer" aria-label={`${member.displayName} on LinkedIn`}><BriefcaseBusiness size={13} aria-hidden="true" />LinkedIn</a> : null}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mentor-section">
          <p className="section-kicker">Your mentor</p>
          <h2>{data.mentor?.displayName ?? "To be assigned"}</h2>
          {data.mentor?.details ? <p>{data.mentor.details}</p> : null}
          <div className="mentor-links">
            {data.mentor?.phone ? <a href={`tel:${data.mentor.phone}`}><MessageCircle size={15} aria-hidden="true" />{data.mentor.phone}</a> : null}
            {data.mentor?.phone ? <a href={`https://wa.me/${data.mentor.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle size={15} aria-hidden="true" />WhatsApp</a> : null}
            {data.mentor?.email ? <a href={`mailto:${data.mentor.email}`}><Mail size={15} aria-hidden="true" />{data.mentor.email}</a> : null}
            {data.mentor?.linkedin ? <a href={data.mentor.linkedin} target="_blank" rel="noreferrer"><BriefcaseBusiness size={15} aria-hidden="true" />LinkedIn</a> : null}
          </div>
        </section>
      </div>

      <section className="wifi-section" aria-labelledby="wifi-heading">
        <div>
          <p className="section-kicker">Venue Wi-Fi</p>
          <h2 id="wifi-heading">Get connected.</h2>
        </div>
        <div className="wifi-connections">
          {wifiConnections.map(({ network, password }, index) => (
            <div className="wifi-connection" key={`${index}-${network}`}>
              <p>Wi-Fi {index + 1}</p>
              <dl>
                <div className="wifi-detail">
                  <dt>Network</dt>
                  <dd>{network}<button className="copy-button" type="button" onClick={() => void copyWifi(`${index}-network`, "network", network)} aria-label={`Copy ${network} network`}>{copiedWifi === `${index}-network` ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button></dd>
                </div>
                <div className="wifi-detail">
                  <dt>Password</dt>
                  <dd>{password || "No password"}{password ? <button className="copy-button" type="button" onClick={() => void copyWifi(`${index}-password`, "password", password)} aria-label={`Copy Wi-Fi ${index + 1} password`}>{copiedWifi === `${index}-password` ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button> : null}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="event-copy">
        <div>
          <p className="section-kicker">Event guide</p>
          <h2>Build something real.</h2>
        </div>
        <div>
          <p>{settings.eventDetails}</p>
          {eventUrl ? <a href={eventUrl} target="_blank" rel="noreferrer">Venue, hosts, prizes, and full event details ↗</a> : null}
        </div>
      </section>

      <section className="build-categories-section" aria-labelledby="build-categories-heading">
        <div>
          <p className="section-kicker">Build categories</p>
          <h2 id="build-categories-heading">Pick your lane.</h2>
        </div>
        <div className="build-category-list">
          {buildCategories.map((category, index) => (
            <div className="build-category" key={category}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{category}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="resources-section" aria-labelledby="resources-heading">
        <div>
          <p className="section-kicker">Quick links</p>
          <h2 id="resources-heading">Keep moving.</h2>
        </div>
        <div className="resource-links">
          {eventQuickLinks.map(({ label, detail, href }) => (
            <a href={href} target="_blank" rel="noreferrer" key={label}>
              <strong>{label} ↗</strong>
              <small>{detail}</small>
            </a>
          ))}
        </div>
      </section>

      {connectPrompt ? (
        <section className="agent-connect-section" aria-labelledby="agent-connect-heading">
          <div className="agent-connect-copy">
            <p className="section-kicker">Your agent, at this event</p>
            <h2 id="agent-connect-heading">Ask Codex about tonight.</h2>
            <ul className="agent-connect-skills">
              <li>Who is my mentor and how do I reach them</li>
              <li>Who is on my team and who checked in</li>
              <li>What is the Wi-Fi password</li>
              <li>What happens next on the agenda</li>
              <li>Where are my Codex and API credits</li>
            </ul>
          </div>
          <div className="agent-connect-actions">
            <button className="portal-link-primary" type="button" onClick={() => void copyConnectPrompt()}>
              {copiedConnectPrompt ? <><Check size={15} aria-hidden="true" />Prompt copied</> : <><Copy size={15} aria-hidden="true" />Copy install prompt</>}
            </button>
            <small>Paste it into Codex. Contains your personal key — keep it out of git.</small>
          </div>

          <details className="agent-connect-manual">
            <summary>Set it up manually</summary>
            <dl>
              {manualInstallSteps.map(({ label, hint, value }) => (
                <div className="agent-connect-step" key={label}>
                  <dt>{label}<small>{hint}</small></dt>
                  <dd>
                    <pre>{maskEventKey(value, eventKey)}</pre>
                    <button className="copy-button" type="button" onClick={() => void copyManualStep(label, value)} aria-label={`Copy ${label}`}>
                      {copiedManualStep === label ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      ) : null}

      <section className="participant-photos-teaser" aria-labelledby="participant-photos-heading">
        <div className="participant-photos-teaser-copy">
          <p className="section-kicker">Event photos</p>
          <h2 id="participant-photos-heading">Keep the frames that are yours.</h2>
          <p>Browse the event gallery, shortlist the photos you appear in, and download your picks in original quality.</p>
        </div>
        <div className="participant-photos-teaser-links">
          <a href={photosPagePath("all")} onClick={internalLinkHandler(photosPagePath("all"))}>Browse all photos <ArrowRight size={14} aria-hidden="true" /></a>
          <a href={photosPagePath("mine")} onClick={internalLinkHandler(photosPagePath("mine"))}>My photos <ArrowRight size={14} aria-hidden="true" /></a>
        </div>
      </section>

      <section className="agenda-section">
        <div className="agenda-heading">
          <div><p className="section-kicker">Tonight’s run of show</p><h2>From doors to demos.</h2></div>
          {eventUrl ? <a href={eventUrl} target="_blank" rel="noreferrer">View event details ↗</a> : null}
        </div>
        <div className="agenda-list">
          {agenda.split("\n").map((item) => item.trim()).filter(Boolean).map((item, index, items) => {
            const isGroup = agendaGroupLabels.has(item.toUpperCase());
            const itemNumber = items.slice(0, index + 1).filter((candidate) => !agendaGroupLabels.has(candidate.toUpperCase())).length;
            return (
              <div className={`agenda-row${isGroup ? " agenda-group" : ""}`} key={`${index}-${item}`}>
                <span>{isGroup ? "" : String(itemNumber).padStart(2, "0")}</span>
                <p>{item}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="qa-section">
        <div><p className="section-kicker">Need to know</p><h2>Questions &amp; answers.</h2></div>
        <div className="qa-list">
          {questionsAndAnswers.map(({ question, answer }) => (
            <details className="qa-item" key={question}>
              <summary>{question}</summary>
              <p>{formatQuestionAnswer(answer)}</p>
            </details>
          ))}
        </div>
      </section>

      <footer>
        <span>OpenAI Build Week Tel Aviv</span>
        <span className="footer-support">
          {data.participant.email} · Status updates are controlled by event admins. Contact an event admin for support.
        </span>
      </footer>
    </main>
  );
}

const localPreviewData: PortalData = {
  participant: { displayName: "Ada Lovelace", email: "ada@example.test", teamName: "Compiler Crew", checkedIn: false, checkedInAt: null },
  teamTable: { tableNumber: "12", note: "Floor 2, near the fridge" },
  teamMembers: [
    { displayName: "Ada Lovelace", isCurrentUser: true, checkedIn: false, phone: null, linkedin: null },
    { displayName: "Alan Turing", isCurrentUser: false, checkedIn: true, phone: "+972-50-000-0103", linkedin: null },
    { displayName: "Grace Hopper", isCurrentUser: false, checkedIn: true, phone: null, linkedin: "https://www.linkedin.com/in/gracehopper/" },
  ],
  mentor: {
    displayName: "Radia Perlman",
    email: "radia.mentor@example.test",
    phone: "+972-50-000-0102",
    details: "Ask me about systems, networks, and making complicated things feel simple.",
    linkedin: "https://www.linkedin.com/in/radiaperlman/",
  },
  settings: {
    eventName: "Codex Hackathon — Tel Aviv",
    eventUrl: "https://example.test/event",
    wifiNetwork: "EventGuest",
    wifiPassword: "example-password",
    wifiNetworkSecondary: "",
    wifiPasswordSecondary: "",
    eventDetails: "Build with your team, get unstuck with a mentor, and ship something useful before the demos.",
    agenda: fallbackAgenda,
    questionsAndAnswers: defaultQuestionsAndAnswers,
    promoInstructions: defaultPromoInstructions,
    partnerCouponCode: "DEMO-COUPON",
    partnerRegistrationUrl: "https://example.test/register",
  },
  promoLinks: { codexCredits: null, apiCredits: null },
};

function PromoInstructions({ instructions }: { instructions: string }) {
  const groups = instructions.split(/\n\s*\n/).map((group) => group.split("\n").map((line) => line.trim()).filter(Boolean)).filter((group) => group.length);

  return (
    <div className="promo-instructions">
      {groups.map((group, groupIndex) => {
        const [firstLine, ...remainingLines] = group;
        if (!firstLine) return null;
        const isHeading = groupIndex === 0 && firstLine.endsWith(":");
        if (isHeading) {
          return <section key={groupIndex}><p className="promo-instructions-title">{firstLine}</p><ol className="promo-steps">{remainingLines.map((line) => <li key={line}><span className="promo-step-body">{formatInstructionLine(line)}</span></li>)}</ol></section>;
        }
        if (groupIndex === 1) {
          return <aside className="promo-instructions-callout" key={groupIndex}><span className="promo-callout-label">Heads up</span><p>{formatInstructionLine(group.join(" "))}</p></aside>;
        }
        return <ul className="promo-reference" key={groupIndex}>{group.map((line) => <PromoReferenceRow key={line} line={line} />)}</ul>;
      })}
    </div>
  );
}

function PromoReferenceRow({ line }: { line: string }) {
  const [, label, value] = /^([^:\s][^:]{0,13}):\s+(.+)$/.exec(line) ?? [];
  if (!label || !value) return <li className="promo-reference-note">{formatInstructionLine(line)}</li>;
  return <li><span className="promo-reference-label">{label}</span><span>{formatInstructionLine(value)}</span></li>;
}

function formatInstructionLine(line: string) {
  const parts = line.split(/(https?:\/\/\S*[^\s.,;:)]|chatgpt\.com\/(?:codex\/)?p\/<code>)/g);
  return parts.map((part, index) => {
    if (!/^(https?:\/\/|chatgpt\.com\/)/.test(part)) return part;
    // Templated URLs carry a <placeholder>, so they are shown as literals instead of links.
    if (part.includes("<")) return <code key={index}>{part}</code>;
    const href = part.startsWith("http") ? part : `https://${part}`;
    return <a className="promo-link" key={index} href={href} target="_blank" rel="noreferrer">{part}</a>;
  });
}

function CreditVault({ checkedIn, copiedPromo, instructions, partnerCouponCode, partnerRegistrationUrl, promoLinks, onApply, onCopy }: {
  checkedIn: boolean;
  copiedPromo: "codex" | "api" | "base44" | null;
  instructions: string;
  partnerCouponCode: string;
  partnerRegistrationUrl: string;
  promoLinks: PortalData["promoLinks"];
  onApply: (kind: "codex" | "api") => void;
  onCopy: (kind: "codex" | "api" | "base44", value: string) => Promise<void>;
}) {
  const promoOptions = [
    { kind: "codex", label: "Codex credits", value: promoLinks.codexCredits },
    { kind: "api", label: "API token credits", value: promoLinks.apiCredits },
  ] satisfies Array<{ kind: "codex" | "api"; label: string; value: string | null }>;

  return (
    <section className={`credit-vault ${checkedIn ? "unlocked" : "locked"}`}>
      <div className="credit-vault-copy">
        <p className="section-kicker">Codex build credit</p>
        <h2>{checkedIn ? "Unlocked for your build." : "Unlocks at check-in."}</h2>
        <PromoInstructions instructions={instructions} />
        <p className="credit-delay-note">{checkedIn ? "Credits can take a few minutes to appear after check-in. Refresh status if you do not see them yet." : "After check-in, credits can take a few minutes to appear."}</p>
      </div>
      <div className="credit-tokens">
        {promoOptions.map(({ kind, label, value }) => {
          const redemptionUrl = value ? promoRedemptionUrl(kind, value) : null;
          // API promos are pasted into the billing page, so the code stays the copy target; Codex applies directly via its link.
          const copyValue = kind === "api" ? (value && !isHttpUrl(value) ? value : redemptionUrl) : null;
          return (
          <div className="credit-token" key={kind}>
            <span>{label} · Personal · One time</span>
            {checkedIn && redemptionUrl ? <a className="credit-redeem" href={redemptionUrl} target="_blank" rel="noreferrer" onClick={() => onApply(kind)}>Redeem {label} ↗</a> : <strong className={checkedIn ? undefined : "credit-placeholder"}>{checkedIn ? "ASK THE WELCOME DESK" : "••••-••••-••••"}</strong>}
            {checkedIn && value && !isHttpUrl(value) ? <strong>{value}</strong> : null}
            {checkedIn && kind === "codex" && redemptionUrl ? <a className="credit-apply" href={redemptionUrl} target="_blank" rel="noreferrer" onClick={() => onApply(kind)}>Apply</a> : checkedIn && copyValue ? <button onClick={() => void onCopy(kind, copyValue)}>{copiedPromo === kind ? "Copied" : isHttpUrl(copyValue) ? "Copy link" : "Copy code"}</button> : <small>{checkedIn ? `${label} is missing` : "Check in to reveal"}</small>}
          </div>
          );
        })}
        {checkedIn && partnerCouponCode ? <div className="credit-token base44-credit">
          <span>Base44 · Shared event coupon</span>
          <strong>2,000 Integration Credits</strong>
          <p>Build on Codex, then deploy on <a href="https://base44.com/backend" target="_blank" rel="noreferrer">Base44’s backend</a> with database, auth, realtime, integrations, backend functions, and hosting built in.</p>
          <ol>
            {partnerRegistrationUrl ? <li><a href={partnerRegistrationUrl} target="_blank" rel="noreferrer">Open a Free Base44 account ↗</a></li> : null}
            <li>Open your workspace profile, then select <strong>Credits</strong>.</li>
            <li>Under <strong>Redeem a coupon or gift card</strong>, apply the coupon code.</li>
          </ol>
          <code>{partnerCouponCode}</code>
          <button onClick={() => void onCopy("base44", partnerCouponCode)}>{copiedPromo === "base44" ? "Copied" : "Copy coupon code"}</button>
        </div> : null}
      </div>
    </section>
  );
}

function promoRedemptionUrl(kind: "codex" | "api", value: string): string {
  if (isHttpUrl(value)) return value;
  return kind === "codex"
    ? `https://chatgpt.com/codex/p/${encodeURIComponent(value)}`
    : "https://platform.openai.com/settings/organization/billing/promotions";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
