import { useEffect, useMemo, useState } from "react";

import { countAvailableCredits, getPromoInventoryStatus, isCompletePromo } from "../src/promo-inventory";
import { AdminHeader, type AdminPage } from "./AdminHeader";
import { base44 } from "./base44Client";
import { downloadCsv } from "./lib/download-csv";
import type { AppUser, ParticipantRecord, PromoCodeRecord } from "./types";

const participantEntity = base44.entities.Participant!;
const promoEntity = base44.entities.PromoCode!;

type AssignmentFilter = "all" | "assigned" | "available" | "blocked" | "incomplete";

export function AdminCodesPage({ user, onNavigate }: { user: AppUser; onNavigate: (page: AdminPage) => void }) {
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [promos, setPromos] = useState<PromoCodeRecord[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssignmentFilter>("all");
  const [copiedPromoId, setCopiedPromoId] = useState<string | null>(null);
  const [updatingPromoId, setUpdatingPromoId] = useState<string | null>(null);
  const [notice, setNotice] = useState("Loading promo codes…");

  useEffect(() => {
    // The ledger is remote Base44 state and must be loaded after admin authentication.
    void loadCodes();
  }, []);

  async function loadCodes() {
    try {
      const [participantRows, promoRows] = await Promise.all([
        participantEntity.list("display_name", 5000),
        promoEntity.list("created_date", 5000),
      ]);
      setParticipants(participantRows as ParticipantRecord[]);
      setPromos(promoRows as PromoCodeRecord[]);
      setNotice("Promo code assignments are current");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not load promo codes");
    }
  }

  const participantsByEmail = useMemo(
    () => new Map(participants.map((participant) => [participant.email.trim().toLowerCase(), participant])),
    [participants],
  );

  const visiblePromos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return promos.filter((promo) => {
      const status = getPromoInventoryStatus(promo);
      if (filter !== "all" && status !== filter) return false;
      if (!normalizedQuery) return true;

      const participant = participantsByEmail.get(promo.assigned_email.trim().toLowerCase());
      return [codexCreditValue(promo), apiCreditValue(promo), promo.assigned_email, participant?.display_name, participant?.team_name]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [filter, participantsByEmail, promos, query]);

  function exportPromos() {
    downloadCsv("promo-codes", ["Status", "Codex Credits", "API Token Credits", "Assigned To", "Assigned Email", "Team", "Assigned At"], visiblePromos.map((promo) => {
      const participant = participantsByEmail.get(promo.assigned_email.trim().toLowerCase());
      return [
        getPromoInventoryStatus(promo),
        codexCreditValue(promo),
        apiCreditValue(promo),
        participant?.display_name ?? "",
        promo.assigned_email,
        participant?.team_name ?? "",
        promo.assigned_at ?? "",
      ];
    }));
    setNotice(`Exported ${visiblePromos.length} promo code${visiblePromos.length === 1 ? "" : "s"} as CSV`);
  }

  const assignedCount = promos.filter(({ assigned_email }) => assigned_email).length;
  const blockedCount = promos.filter(({ blocked }) => blocked === true).length;
  const availableCredits = countAvailableCredits(promos);

  async function copyPromo(promo: PromoCodeRecord) {
    const codexCredits = codexCreditValue(promo);
    await navigator.clipboard.writeText(`Codex Credits: ${codexCredits}\nAPI Token Credits: ${apiCreditValue(promo)}`);
    setCopiedPromoId(promo.id);
    setNotice(`Copied promo credits${promo.assigned_email ? ` assigned to ${promo.assigned_email}` : ""}`);
  }

  async function toggleBlocked(promo: PromoCodeRecord) {
    if (promo.assigned_email) return;
    const blocked = promo.blocked !== true;
    setUpdatingPromoId(promo.id);
    try {
      await promoEntity.update(promo.id, { blocked });
      setPromos((current) => current.map((item) => item.id === promo.id ? { ...item, blocked } : item));
      setNotice(blocked ? "Promo credits blocked from assignment" : "Promo credits available for assignment");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not update promo credits");
    } finally {
      setUpdatingPromoId(null);
    }
  }

  return (
    <main className="admin-shell">
      <AdminHeader activePage="codes" user={user} onNavigate={onNavigate} />
      <section className="admin-stats credits-stats">
        <CodeStat label="Codex credits" value={availableCredits.codex} />
        <CodeStat label="API credits" value={availableCredits.api} />
        <CodeStat label="Assigned" value={assignedCount} />
        <CodeStat label="Blocked" value={blockedCount} />
      </section>
      <section className="codes-ledger" aria-labelledby="codes-heading">
        <div className="codes-toolbar">
          <div><p className="section-kicker">Assignment ledger</p><h2 id="codes-heading">All promo codes</h2></div>
          <div className="codes-controls">
            <input type="search" placeholder="Search code, person, email, or team" aria-label="Search promo codes" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="codes-filters" aria-label="Filter promo codes">
              {(["all", "assigned", "available", "blocked", "incomplete"] satisfies AssignmentFilter[]).map((option) => (
                <button key={option} aria-pressed={filter === option} onClick={() => setFilter(option)}>{option}</button>
              ))}
            </div>
            <button className="export-button codes-export" type="button" disabled={!visiblePromos.length} onClick={exportPromos}>Export CSV</button>
          </div>
        </div>
        <p className="codes-notice" role="status" aria-live="polite">{notice} · Showing {visiblePromos.length}</p>
        <div className="codes-table">
          <div className="codes-table-header" aria-hidden="true"><span>Status</span><span>Credits</span><span>Assigned to</span><span>Assigned at</span><span>Actions</span></div>
          {visiblePromos.map((promo) => {
            const participant = participantsByEmail.get(promo.assigned_email.trim().toLowerCase());
            const status = getPromoInventoryStatus(promo);
            const complete = isCompletePromo(promo);
            return (
              <article className="code-row" key={promo.id}>
                <span className={`code-status ${status}`}>{status}</span>
                <div className="code-values"><CodeValue label="Codex" value={codexCreditValue(promo) || "Missing Codex credit"} /><CodeValue label="API" value={apiCreditValue(promo) || "Missing API credit"} /></div>
                <div className="code-assignee">
                  <strong>{participant?.display_name || (promo.assigned_email ? "Participant not in roster" : status === "blocked" ? "Blocked" : complete ? "Not assigned" : codexCreditValue(promo) ? "Needs API credit" : "Needs Codex credit")}</strong>
                  <small>{promo.assigned_email || (status === "blocked" ? "Will not be assigned" : complete ? "Ready for assignment" : "Excluded from assignment")}</small>
                  {participant?.team_name ? <small>{participant.team_name}</small> : null}
                </div>
                <time dateTime={promo.assigned_at}>{formatAssignedAt(promo.assigned_at)}</time>
                <div className="code-actions">
                  <button className="code-copy" disabled={!complete} onClick={() => void copyPromo(promo)}>{complete ? copiedPromoId === promo.id ? "Copied" : "Copy" : "Incomplete"}</button>
                  <button className="code-block" disabled={Boolean(promo.assigned_email) || updatingPromoId === promo.id} onClick={() => void toggleBlocked(promo)}>{promo.blocked ? "Unblock" : "Block"}</button>
                </div>
              </article>
            );
          })}
          {visiblePromos.length === 0 ? <p className="codes-empty">No promo codes match this view.</p> : null}
        </div>
      </section>
    </main>
  );
}

function CodeStat({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function CodeValue({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><span title={value}>{value}</span></div>;
}

function formatAssignedAt(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function apiCreditValue(promo: PromoCodeRecord): string {
  return promo.api_credit_code || promo.api_credit_url || "";
}

function codexCreditValue(promo: PromoCodeRecord): string {
  return promo.codex_credit_url || promo.code;
}
