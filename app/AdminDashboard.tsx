import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Pencil } from "lucide-react";

import {
  normalizeParticipantName,
  parseCheckInCsv,
  parseMentorTeamCsv,
  parseParticipantCsv,
  parsePromoFiles,
} from "../src/csv";
import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { runBulkCheckIn } from "../src/bulk-check-in";
import { reconcileParticipants } from "../src/participant-reconciliation";
import { countAvailableCredits } from "../src/promo-inventory";
import { planPromoImport } from "../src/promo-import";
import { AdminHeader, type AdminPage } from "./AdminHeader";
import { base44 } from "./base44Client";
import { Checkbox } from "./components/ui/checkbox";
import { downloadCsv } from "./lib/download-csv";
import { adminParticipantPath, adminTeamPath, internalLinkHandler } from "./navigation";
import type {
  AppUser,
  MentorRecord,
  ParticipantRecord,
  PromoCodeRecord,
} from "./types";

const participantEntity = base44.entities.Participant!;
const mentorEntity = base44.entities.Mentor!;
const promoEntity = base44.entities.PromoCode!;
const accessDeliveryAttemptEntity = base44.entities.AccessDeliveryAttempt!;
const guestEntity = base44.entities.Guest!;
const teamInfoEntity = base44.entities.TeamInfo!;
const accessExpiresAt = "2026-08-01T21:00:00.000Z";

interface AccessAdminResponse {
  links?: Array<{ participantId: string; url: string }>;
  participantId?: string;
  status?: string;
  results?: Array<{ participantId: string; status: string; error?: string }>;
}

interface PromoAssignmentResponse {
  displayName?: string;
  teamName?: string;
  createdTeam?: boolean;
  promoLinks: { codexCredits: string; apiCredits: string } | null;
}

interface ExceptionForm {
  displayName: string;
  email: string;
  teamName: string;
}

type ParticipantActionKind = "copy" | "send" | "rotate" | "check-in" | "check-out";

type ParticipantFilter = "all" | "sent" | "unsent" | "checked in" | "not checked in";

const participantFilters = ["all", "sent", "unsent", "checked in", "not checked in"] satisfies ParticipantFilter[];

interface ParticipantAction {
  participantId: string;
  kind: ParticipantActionKind;
}

const emptyExceptionForm: ExceptionForm = { displayName: "", email: "", teamName: "" };

export function AdminDashboard({ user, onNavigate }: { user: AppUser; onNavigate: (page: AdminPage) => void }) {
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [promos, setPromos] = useState<PromoCodeRecord[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ParticipantFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeParticipantAction, setActiveParticipantAction] = useState<ParticipantAction | null>(null);
  const [completedParticipantAction, setCompletedParticipantAction] = useState<ParticipantAction | null>(null);
  const [sendingSelected, setSendingSelected] = useState(false);
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [exceptionForm, setExceptionForm] = useState<ExceptionForm>(emptyExceptionForm);
  const [notice, setNotice] = useState("Loading event data…");
  const [busy, setBusy] = useState(false);
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const actionConfirmationTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Admin workspace data is remote Base44 state and must be loaded after authentication.
    void reload();
  }, []);

  async function reload(preserveNotice = false) {
    try {
      const [participantRows, promoRows] = await Promise.all([
        participantEntity.list("display_name", 5000),
        promoEntity.list("created_date", 5000),
      ]);
      const activeParticipants = (participantRows as ParticipantRecord[]).filter((participant) => participant.active !== false);
      const activeParticipantIds = new Set(activeParticipants.map(({ id }) => id));
      setParticipants(activeParticipants);
      setSelected((current) => new Set([...current].filter((participantId) => activeParticipantIds.has(participantId))));
      setPromos(promoRows as PromoCodeRecord[]);
      if (!preserveNotice) setNotice("Event data is current");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not load admin data");
    }
  }

  async function importParticipants(file: File) {
    await runImport(async () => {
      const imported = parseParticipantCsv(await file.text());
      const existing = await participantEntity.list("display_name", 5000) as ParticipantRecord[];
      const reconciliation = reconcileParticipants(imported, existing, () => crypto.randomUUID(), accessExpiresAt);
      const mentors = new Map<string, Omit<MentorRecord, "id">>();
      for (const row of imported) {
        mentors.set(row.mentorKey, {
          mentor_key: row.mentorKey,
          display_name: row.mentorName,
          email: row.mentorEmail,
          phone: row.mentorPhone,
          details: row.mentorDetails,
        });
      }

      await mentorEntity.deleteMany({});
      if (reconciliation.creates.length) await participantEntity.bulkCreate(reconciliation.creates);
      for (const batch of [reconciliation.updates, reconciliation.deactivations]) {
        for (let index = 0; index < batch.length; index += 20) {
          await Promise.all(batch.slice(index, index + 20).map(({ id, data }) => participantEntity.update(id, data)));
        }
      }
      await mentorEntity.bulkCreate([...mentors.values()]);
      setNotice(`Imported ${imported.length} participants, preserved ${reconciliation.updates.length} access links, and disabled ${reconciliation.deactivations.length} removed guests`);
    });
  }

  async function importPromos(files: File[]) {
    await runImport(async () => {
      const imported = parsePromoFiles(await Promise.all(files.map((file) => file.text())));
      const existing = await promoEntity.list("created_date", 5000) as PromoCodeRecord[];
      const plan = planPromoImport(imported, existing);
      for (const { id, data } of plan.updates) await promoEntity.update(id, data);
      if (plan.creates.length) await promoEntity.bulkCreate(plan.creates);
      setNotice(`Added ${plan.creates.length} credit rows, completed ${plan.updates.length} pairs, and kept ${plan.unchanged} duplicates unchanged`);
    });
  }

  async function importMentorTeams(file: File) {
    await runImport(async () => {
      const teams = parseMentorTeamCsv(await file.text());
      const participantsByName = new Map<string, ParticipantRecord[]>();
      for (const participant of participants) {
        const key = normalizeParticipantName(participant.display_name);
        participantsByName.set(key, [...(participantsByName.get(key) ?? []), participant]);
      }

      const existingMentors = await mentorEntity.list("display_name", 5000) as MentorRecord[];
      const mentorsByKey = new Map(existingMentors.map((mentor) => [mentor.mentor_key, mentor]));
      const updates: Array<{ participant: ParticipantRecord; teamKey: string; teamName: string; mentorKey: string }> = [];
      let unmatched = 0;
      for (const team of teams) {
        const existingMentor = mentorsByKey.get(team.mentorKey);
        const mentorPayload = {
          mentor_key: team.mentorKey,
          display_name: team.mentorName,
          details: team.mentorDetails || existingMentor?.details || "",
        };
        if (existingMentor) await mentorEntity.update(existingMentor.id, mentorPayload);
        if (!existingMentor) {
          const created = await mentorEntity.create(mentorPayload) as MentorRecord;
          mentorsByKey.set(team.mentorKey, created);
        }

        for (const memberName of team.memberNames) {
          const matches = participantsByName.get(normalizeParticipantName(memberName)) ?? [];
          if (matches.length !== 1) {
            unmatched += 1;
            continue;
          }
          updates.push({
            participant: matches[0]!,
            teamKey: team.teamKey,
            teamName: team.teamName,
            mentorKey: team.mentorKey,
          });
        }
      }

      for (let index = 0; index < updates.length; index += 20) {
        await Promise.all(updates.slice(index, index + 20).map(({ participant, teamKey, teamName, mentorKey }) =>
          participantEntity.update(participant.id, {
            team_key: teamKey,
            team_name: teamName,
            mentor_key: mentorKey,
          })
        ));
      }
      const assignedEmails = new Set(updates.map(({ participant }) => participant.email));
      setNotice(`Assigned ${assignedEmails.size} participants across ${teams.length} teams; ${unmatched} sheet names need review`);
    });
  }

  async function importCheckIns(file: File) {
    await runImport(async () => {
      const updates = parseCheckInCsv(await file.text());
      const response = unwrapBase44FunctionResponse<{
        results: Array<{ success: boolean; error?: string }>;
      }>(await base44.functions.invoke("check-in-participants", { updates }));
      const failed = response.results.filter((result) => !result.success);
      setNotice(failed.length ? `${response.results.length - failed.length} updated; ${failed.length} failed: ${failed[0]?.error}` : `${response.results.length} check-in statuses updated`);
    });
  }

  async function resetSystem() {
    resetDialogRef.current?.close();
    await runImport(async () => {
      await Promise.all([
        accessDeliveryAttemptEntity.deleteMany({}),
        guestEntity.deleteMany({}),
        mentorEntity.deleteMany({}),
        participantEntity.deleteMany({}),
        promoEntity.deleteMany({}),
        teamInfoEntity.deleteMany({}),
      ]);
      setSelected(new Set());
      setNotice("System reset complete. Participants, teams, mentors, check-ins, access history, and promo pairs were deleted. Event content was preserved.");
    });
  }

  async function toggleCheckIn(participant: ParticipantRecord) {
    const kind = participant.checked_in ? "check-out" : "check-in";
    await runParticipantAction({ participantId: participant.id, kind }, async () => {
      const response = unwrapBase44FunctionResponse<{
        results: Array<{ success: boolean; error?: string }>;
      }>(await base44.functions.invoke("check-in-participants", {
        updates: [{ email: participant.email, checkedIn: !participant.checked_in }],
      }));
      const result = response.results[0];
      if (!result?.success) throw new Error(result?.error ?? "Check-in failed");
      setNotice(`${participant.display_name} ${participant.checked_in ? "checked out" : "checked in"}`);
    });
  }

  async function copyAccessLink(participant: ParticipantRecord) {
    await runParticipantAction({ participantId: participant.id, kind: "copy" }, async () => {
      const response = unwrapBase44FunctionResponse<AccessAdminResponse>(await base44.functions.invoke("access-admin", {
        action: "links",
        participantIds: [participant.id],
      }));
      const link = response.links?.[0]?.url;
      if (!link) throw new Error("Could not create the personal link");
      await navigator.clipboard.writeText(link);
      setNotice(`Copied ${participant.display_name}’s personal link`);
    });
  }

  async function checkInSelected(participantIds: string[]) {
    if (!participantIds.length) {
      setNotice("Select at least one participant");
      return;
    }
    const participantIdSet = new Set(participantIds);
    const pendingParticipants = participants.filter(({ id, checked_in }) => participantIdSet.has(id) && !checked_in);
    if (!pendingParticipants.length) {
      setNotice("All selected participants are already checked in");
      return;
    }
    await runImport(async () => {
      const outcome = await runBulkCheckIn(pendingParticipants, 500, async (batch) => {
        const response = unwrapBase44FunctionResponse<{ results: Array<{ email: string; success: boolean; error?: string }> }>(await base44.functions.invoke("check-in-participants", {
          updates: batch.map(({ email }) => ({ email, checkedIn: true })),
        }));
        return response.results;
      });
      const failedEmails = new Set(outcome.results.filter(({ success }) => !success).map(({ email }) => email.trim().toLowerCase()));
      const failedIds = pendingParticipants.filter(({ email }) => failedEmails.has(email.toLowerCase())).map(({ id }) => id);
      const remainingIds = [...failedIds, ...outcome.unprocessed.map(({ id }) => id)];
      setSelected(new Set(remainingIds));
      const checkedInCount = outcome.results.filter(({ success }) => success).length;
      if (outcome.error) {
        setNotice(`${checkedInCount} checked in; ${failedIds.length} failed; ${outcome.unprocessed.length} not processed: ${outcome.error}`);
        return;
      }
      setNotice(failedIds.length
        ? `${checkedInCount} checked in; ${failedIds.length} failed and remain selected`
        : `${checkedInCount} participant${checkedInCount === 1 ? "" : "s"} checked in`);
    });
  }

  async function sendSelectedAccessLinks(participantIds: string[]) {
    if (!participantIds.length) {
      setNotice("Select at least one participant");
      return;
    }
    const selectedIds = new Set(participantIds);
    const eligibleIds = participants.filter(({ id, checked_in }) => selectedIds.has(id) && checked_in).map(({ id }) => id);
    const eligibleIdSet = new Set(eligibleIds);
    const checkedOutIds = participantIds.filter((participantId) => !eligibleIdSet.has(participantId));
    if (!eligibleIds.length) {
      setNotice("Check in the selected participants before sending links");
      return;
    }
    setSendingSelected(true);
    try {
      await runImport(async () => {
        const results: NonNullable<AccessAdminResponse["results"]> = [];
        for (const ids of chunk(eligibleIds, 25)) {
          const response = unwrapBase44FunctionResponse<AccessAdminResponse>(await base44.functions.invoke("access-admin", {
            action: "send",
            mode: "selected",
            participantIds: ids,
            requestId: crypto.randomUUID(),
          }));
          results.push(...(response.results ?? []));
        }

        const acceptedIds = new Set(results.filter(({ status }) => status === "accepted").map(({ participantId }) => participantId));
        const skippedResults = results.filter(({ status }) => status === "skipped");
        const skippedIds = new Set(skippedResults.map(({ participantId }) => participantId));
        const failedIds = eligibleIds.filter((participantId) => !acceptedIds.has(participantId) && !skippedIds.has(participantId));
        const skippedParticipantIds = [...new Set([...checkedOutIds, ...skippedIds])];
        const remainingIds = [...skippedParticipantIds, ...failedIds];
        const checkedOutSkipped = new Set([
          ...checkedOutIds,
          ...skippedResults.filter(({ error }) => error === "check_in_required").map(({ participantId }) => participantId),
        ]).size;
        const deliveryInProgress = skippedResults.filter(({ error }) => error === "delivery_in_progress").length;
        const otherSkipped = skippedParticipantIds.length - checkedOutSkipped - deliveryInProgress;
        const skippedNotice = [
          checkedOutSkipped ? `${checkedOutSkipped} checked-out skipped` : "",
          deliveryInProgress ? `${deliveryInProgress} already sending` : "",
          otherSkipped ? `${otherSkipped} otherwise ineligible` : "",
        ].filter(Boolean).join("; ");
        if (failedIds.length) {
          setSelected(new Set(remainingIds));
          setNotice(`${acceptedIds.size} sent; ${failedIds.length} failed${skippedNotice ? `; ${skippedNotice}` : ""}`);
          return;
        }
        setSelected(new Set(skippedParticipantIds));
        setNotice(skippedNotice
          ? `${acceptedIds.size} sent; ${skippedNotice}`
          : `Sent ${acceptedIds.size} personal link${acceptedIds.size === 1 ? "" : "s"}`);
      });
    } finally {
      setSendingSelected(false);
    }
  }

  async function rotateAccessLink(participant: ParticipantRecord) {
    if (!window.confirm(`Rotate ${participant.display_name}’s link? Their previous link will stop working.`)) return;
    await runParticipantAction({ participantId: participant.id, kind: "rotate" }, async () => {
      const response = unwrapBase44FunctionResponse<{ url?: string }>(await base44.functions.invoke("access-admin", {
        action: "rotate",
        participantId: participant.id,
      }));
      if (!response.url) throw new Error("Could not rotate the personal link");
      await navigator.clipboard.writeText(response.url);
      setNotice(`Rotated and copied ${participant.display_name}’s new link`);
    });
  }

  async function sendAccessEmail(participant: ParticipantRecord) {
    await runParticipantAction({ participantId: participant.id, kind: "send" }, async () => {
      const response = unwrapBase44FunctionResponse<AccessAdminResponse>(await base44.functions.invoke("access-admin", {
        action: "email",
        participantId: participant.id,
      }));
      if (response.status !== "accepted") throw new Error("Email was not accepted by Gmail");
      setNotice(`Email sent to ${participant.display_name}`);
    });
  }

  function startEmailEdit(participant: ParticipantRecord) {
    setEditingEmailId(participant.id);
    setEmailDraft(participant.email);
  }

  function cancelEmailEdit() {
    setEditingEmailId(null);
    setEmailDraft("");
  }

  async function saveParticipantEmail(event: FormEvent<HTMLFormElement>, participant: ParticipantRecord) {
    event.preventDefault();
    const email = emailDraft.trim().toLowerCase();
    if (email === participant.email.toLowerCase()) {
      cancelEmailEdit();
      return;
    }
    const succeeded = await runImport(async () => {
      await base44.functions.invoke("check-in-participants", {
        action: "update-email",
        participantId: participant.id,
        email,
      });
      setNotice(`Updated ${participant.display_name}’s email to ${email}`);
    });
    if (succeeded) cancelEmailEdit();
  }

  async function addException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedTeam = teamOptions.find(({ teamName }) => normalizeTeamName(teamName) === normalizeTeamName(exceptionForm.teamName));
    const requestedTeamName = exceptionForm.teamName.trim();
    if (!selectedTeam && !window.confirm(`Team “${requestedTeamName}” does not exist. Create it as a new team?`)) {
      setNotice(`Team “${requestedTeamName}” was not found. Participant was not added.`);
      return;
    }

    const succeeded = await runImport(async () => {
      const response = unwrapBase44FunctionResponse<PromoAssignmentResponse>(await base44.functions.invoke("check-in-participants", {
        action: "add-exception",
        displayName: exceptionForm.displayName,
        email: exceptionForm.email,
        teamKey: selectedTeam?.teamKey ?? "",
        teamName: selectedTeam ? "" : requestedTeamName,
        createTeam: !selectedTeam,
        assignPromo: true,
      }));
      const copied = response.promoLinks ? await copyPromoLinks(response.promoLinks) : false;
      setQuery(exceptionForm.email.trim());
      const teamNotice = response.createdTeam ? ` and created team ${response.teamName}` : "";
      setNotice(response.promoLinks
        ? `Added ${response.displayName}${teamNotice}; coupon assigned${copied ? " and copied" : ""}`
        : `Added ${response.displayName} manually${teamNotice}`);
    });
    if (succeeded) setExceptionForm(emptyExceptionForm);
  }

  function setSelection(participantId: string, isSelected: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (isSelected) {
        next.add(participantId);
        return next;
      }
      next.delete(participantId);
      return next;
    });
  }

  async function runParticipantAction(action: ParticipantAction, operation: () => Promise<void>) {
    window.clearTimeout(actionConfirmationTimerRef.current);
    setCompletedParticipantAction(null);
    setActiveParticipantAction(action);
    const succeeded = await runImport(operation);
    setActiveParticipantAction(null);
    if (!succeeded) return;
    setCompletedParticipantAction(action);
    actionConfirmationTimerRef.current = window.setTimeout(() => setCompletedParticipantAction(null), 1800);
  }

  async function runImport(operation: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    try {
      await operation();
      await reload(true);
      return true;
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Operation failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const visibleParticipants = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return participants.filter((participant) => {
      if (!matchesParticipantFilter(participant, statusFilter)) return false;
      if (!normalized) return true;
      return [participant.display_name, participant.email, participant.team_name].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [participants, query, statusFilter]);

  const teamOptions = useMemo(() => {
    const teams = new Map<string, { teamKey: string; teamName: string }>();
    for (const participant of participants) {
      if (participant.team_key && participant.team_name && !teams.has(participant.team_key)) {
        teams.set(participant.team_key, { teamKey: participant.team_key, teamName: participant.team_name });
      }
    }
    return [...teams.values()].sort((left, right) => left.teamName.localeCompare(right.teamName));
  }, [participants]);

  const assignedPromoEmails = useMemo(
    () => new Set(promos.filter(({ assigned_email }) => assigned_email).map(({ assigned_email }) => assigned_email.toLowerCase())),
    [promos],
  );

  function exportParticipants() {
    downloadCsv("participants", ["Name", "Email", "Phone", "LinkedIn", "Team", "Checked In", "Checked In At", "Mail Status", "Coupon", "Portal Opened At", "Promo Claimed At", "Custom Fields"], visibleParticipants.map((participant) => [
      participant.display_name,
      participant.email,
      participant.phone ?? "",
      participant.linkedin ?? "",
      participant.team_name,
      participant.checked_in ? "yes" : "no",
      participant.checked_in_at ?? "",
      accessEmailStatusLabel(participant.access_email_status),
      assignedPromoEmails.has(participant.email.toLowerCase()) ? "ready" : "not assigned",
      participant.portal_first_seen_at ?? "",
      participant.promo_claimed_at ?? "",
      Object.entries(participant.custom_fields ?? {}).map(([label, value]) => `${label}: ${value}`).join("; "),
    ]));
    setNotice(`Exported ${visibleParticipants.length} participant${visibleParticipants.length === 1 ? "" : "s"} as CSV`);
  }

  const checkedIn = participants.filter((participant) => participant.checked_in).length;
  const portalOpened = participants.filter((participant) => participant.portal_first_seen_at).length;
  const promosClaimed = participants.filter((participant) => participant.promo_claimed_at).length;
  const availableCredits = countAvailableCredits(promos);
  const selectedParticipants = participants.filter(({ id }) => selected.has(id));
  const selectedCheckedIn = selectedParticipants.filter(({ checked_in }) => checked_in).length;
  const selectedCheckedOut = selectedParticipants.length - selectedCheckedIn;

  return (
    <main className="admin-shell">
      <AdminHeader activePage="desk" user={user} onNavigate={onNavigate} />

      <section className="admin-stats credits-stats">
        <AdminStat label="Participants" value={participants.length} />
        <AdminStat label="Checked in" value={checkedIn} />
        <AdminStat label="Opened portal" value={portalOpened} />
        <AdminStat label="Claimed promos" value={promosClaimed} />
        <AdminStat label="Codex credits" value={availableCredits.codex} />
        <AdminStat label="API credits" value={availableCredits.api} />
      </section>

      <section className="import-strip">
        <FileAction label="Participants + teams" detail="Luma export or enriched CSV" example="luma-guests.csv" accept=".csv" disabled={busy} onFiles={([file]) => importParticipants(file!)} />
        <FileAction label="Teams + mentors" detail="Mentors worksheet CSV export" example="mentors-teams.csv" accept=".csv" disabled={busy || participants.length === 0} onFiles={([file]) => importMentorTeams(file!)} />
        <FileAction label="Bulk check-in" detail="Email + checked-in status" example="check-ins.csv" accept=".csv" disabled={busy} onFiles={([file]) => importCheckIns(file!)} />
        <FileAction label="Promo credits" detail="Upload either allocation CSV or both together" example="api.csv + codex_credits.csv" accept=".csv" multiple disabled={busy} onFiles={importPromos} />
        <div className="import-status">
          <p className="notice" role="status" aria-live="polite">{notice}</p>
          <button className="reset-button" type="button" disabled={busy} onClick={() => resetDialogRef.current?.showModal()}>Reset system</button>
        </div>
      </section>

      <dialog className="reset-dialog" ref={resetDialogRef} aria-labelledby="reset-dialog-title">
        <form method="dialog">
          <p className="section-kicker">Destructive action</p>
          <h2 id="reset-dialog-title">Reset the whole system?</h2>
          <p>This permanently deletes participants, teams, mentors, check-ins, promo pairs, and personal-link delivery history. Event content is preserved.</p>
          <div className="reset-dialog-actions">
            <button className="secondary-button" value="cancel">Cancel</button>
            <button className="reset-confirm-button" value="confirm" onClick={(event) => { event.preventDefault(); void resetSystem(); }}>Delete everything</button>
          </div>
        </form>
      </dialog>

      <section className="exception-strip" aria-labelledby="exception-heading">
        <div className="exception-intro">
          <p className="section-kicker">Participants</p>
          <h2 id="exception-heading">Add manually</h2>
          <p>Add a participant who is not in the imported list.</p>
        </div>
        <form className="exception-form" autoComplete="off" onSubmit={(event) => void addException(event)}>
          <label>Name<input required autoComplete="name" value={exceptionForm.displayName} onChange={(event) => setExceptionForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label>Email<input required className="keeper-ignore" type="email" autoComplete="off" value={exceptionForm.email} onChange={(event) => setExceptionForm((current) => ({ ...current, email: event.target.value }))} /></label>
          <label>Team<input required list="exception-team-options" autoComplete="off" placeholder="Choose or enter a team" value={exceptionForm.teamName} onChange={(event) => setExceptionForm((current) => ({ ...current, teamName: event.target.value }))} /></label>
          <datalist id="exception-team-options">{teamOptions.map(({ teamKey, teamName }) => <option key={teamKey} value={teamName} />)}</datalist>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Adding…" : "Add manually"}</button>
        </form>
      </section>

      <section className="participant-table-section">
        <div className="section-heading">
          <div><p className="section-kicker">Door list</p><h2>Participants</h2></div>
          <input type="search" placeholder="Search name, email, or team" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="codes-filters participant-filters" aria-label="Filter participants">
          {participantFilters.map((option) => (
            <button key={option} type="button" aria-pressed={statusFilter === option} onClick={() => setStatusFilter(option)}>{option}</button>
          ))}
        </div>
        <div className="access-actions">
          <button className="primary" disabled={busy || selectedCheckedOut === 0} onClick={() => void checkInSelected([...selected])}>Check in selected</button>
          <button disabled={busy || selectedCheckedIn === 0} onClick={() => void sendSelectedAccessLinks([...selected])}>
            {sendingSelected ? "Sending…" : "Send selected links"}
          </button>
          <button disabled={!visibleParticipants.length} onClick={exportParticipants}>Export CSV</button>
          <span>{selected.size} selected</span>
        </div>
        <div className="participant-table">
          {visibleParticipants.map((participant) => (
            <div className="participant-row" key={participant.id}>
              <Checkbox
                aria-label={`Select ${participant.display_name}`}
                checked={selected.has(participant.id)}
                onCheckedChange={(checked) => setSelection(participant.id, checked === true)}
              />
              <span className={`status-dot ${participant.checked_in ? "checked_in" : ""}`} />
              <div className="participant-identity">
                <strong><a className="team-link" href={adminParticipantPath(participant.id)} onClick={internalLinkHandler(adminParticipantPath(participant.id))}>{participant.display_name}</a></strong>
                {editingEmailId === participant.id ? (
                  <form className="participant-email-editor" onSubmit={(event) => void saveParticipantEmail(event, participant)}>
                    <input
                      autoFocus
                      required
                      aria-label={`Email for ${participant.display_name}`}
                      type="email"
                      value={emailDraft}
                      onChange={(event) => setEmailDraft(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Escape") cancelEmailEdit(); }}
                    />
                    <button type="submit" disabled={busy}>Save</button>
                    <button type="button" disabled={busy} onClick={cancelEmailEdit}>Cancel</button>
                  </form>
                ) : (
                  <span className="participant-email">
                    <small>{participant.email}{participant.is_exception ? " · added manually" : ""}</small>
                    <button
                      className="edit-email-button"
                      type="button"
                      aria-label={`Edit email for ${participant.display_name}`}
                      title="Edit email"
                      disabled={busy}
                      onClick={() => startEmailEdit(participant)}
                    >
                      <Pencil aria-hidden="true" size={12} strokeWidth={1.8} />
                    </button>
                  </span>
                )}
              </div>
              <span>{participant.team_key
                ? <a className="team-link" href={adminTeamPath(participant.team_key)} onClick={internalLinkHandler(adminTeamPath(participant.team_key))}>{participant.team_name}</a>
                : participant.team_name}</span>
              <div className="participant-statuses">
                {participant.access_email_status === "accepted" && (
                  <span className="delivery-status accepted">Mail: sent</span>
                )}
                {participant.portal_last_seen_at && (
                  <span className="delivery-status accepted" title={`First ${formatActivityTime(participant.portal_first_seen_at)} · Last ${formatActivityTime(participant.portal_last_seen_at)}`}>
                    Portal: {formatActivityTime(participant.portal_last_seen_at)}
                  </span>
                )}
                {participant.promo_claimed_at && (
                  <span className="delivery-status accepted" title={`Claimed ${formatActivityTime(participant.promo_claimed_at)}`}>Promo: claimed</span>
                )}
              </div>
              <div className="row-actions">
                <button data-feedback={hasParticipantAction(activeParticipantAction, participant.id, "copy") || hasParticipantAction(completedParticipantAction, participant.id, "copy") || undefined} disabled={busy || !participant.checked_in} onClick={() => void copyAccessLink(participant)}>
                  {hasParticipantAction(activeParticipantAction, participant.id, "copy") ? "Copying…" : hasParticipantAction(completedParticipantAction, participant.id, "copy") ? "Copied" : "Copy link"}
                </button>
                <button data-feedback={hasParticipantAction(activeParticipantAction, participant.id, "send") || hasParticipantAction(completedParticipantAction, participant.id, "send") || undefined} disabled={busy || !participant.checked_in} onClick={() => void sendAccessEmail(participant)}>
                  {hasParticipantAction(activeParticipantAction, participant.id, "send") ? "Sending…" : hasParticipantAction(completedParticipantAction, participant.id, "send") ? "Email sent" : "Send email"}
                </button>
                <button data-feedback={hasParticipantAction(activeParticipantAction, participant.id, "rotate") || hasParticipantAction(completedParticipantAction, participant.id, "rotate") || undefined} disabled={busy || !participant.checked_in} onClick={() => void rotateAccessLink(participant)}>
                  {hasParticipantAction(activeParticipantAction, participant.id, "rotate") ? "Rotating…" : hasParticipantAction(completedParticipantAction, participant.id, "rotate") ? "Rotated" : "Rotate"}
                </button>
                <button data-feedback={hasParticipantAction(activeParticipantAction, participant.id, "check-in") || hasParticipantAction(activeParticipantAction, participant.id, "check-out") || hasParticipantAction(completedParticipantAction, participant.id, "check-in") || hasParticipantAction(completedParticipantAction, participant.id, "check-out") || undefined} disabled={busy} onClick={() => void toggleCheckIn(participant)}>
                  {hasParticipantAction(activeParticipantAction, participant.id, "check-in") ? "Checking in…" : hasParticipantAction(activeParticipantAction, participant.id, "check-out") ? "Checking out…" : hasParticipantAction(completedParticipantAction, participant.id, "check-in") ? "Checked in" : hasParticipantAction(completedParticipantAction, participant.id, "check-out") ? "Checked out" : participant.checked_in ? "Check out" : "Check in"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function FileAction({ label, detail, example, accept, multiple = false, disabled, onFiles }: { label: string; detail: string; example: string; accept: string; multiple?: boolean; disabled: boolean; onFiles: (files: File[]) => Promise<void> }) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  function select(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (files.length) void onFiles(files);
    event.target.value = "";
  }

  function enter(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (disabled) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function leave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current > 0) return;
    dragDepth.current = 0;
    setDragging(false);
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    const files = [...event.dataTransfer.files];
    if (files.length) void onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <label
      className={`file-action${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      onDragEnter={enter}
      onDragLeave={leave}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
    >
      <input type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={select} />
      <span>{label}</span>
      <small>{detail}</small>
      <em>Drop CSV here or browse · e.g. {example}</em>
    </label>
  );
}

function AdminStat({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function hasParticipantAction(action: ParticipantAction | null, participantId: string, kind: ParticipantActionKind): boolean {
  return action?.participantId === participantId && action.kind === kind;
}

function formatActivityTime(timestamp: string | undefined): string {
  if (!timestamp) return "";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function matchesParticipantFilter(participant: ParticipantRecord, filter: ParticipantFilter): boolean {
  if (filter === "sent") return participant.access_email_status === "accepted";
  if (filter === "unsent") return participant.access_email_status !== "accepted";
  if (filter === "checked in") return participant.checked_in;
  if (filter === "not checked in") return !participant.checked_in;
  return true;
}

function accessEmailStatusLabel(status: ParticipantRecord["access_email_status"]): string {
  if (status === "accepted") return "sent";
  if (status === "pending") return "sending";
  if (status === "failed") return "failed";
  if (status === "unknown") return "unknown";
  return "not sent";
}

async function copyPromoLinks(promoLinks: NonNullable<PromoAssignmentResponse["promoLinks"]>): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(`Codex Credits: ${promoLinks.codexCredits}\nAPI Token Credits: ${promoLinks.apiCredits}`);
    return true;
  } catch {
    return false;
  }
}

function normalizeTeamName(teamName: string): string {
  return teamName.trim().toLocaleLowerCase();
}
