import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import { normalizeParticipantName, parseMentorTeamCsv } from "../src/csv";
import { AdminHeader, type AdminPage } from "./AdminHeader";
import { base44 } from "./base44Client";
import { downloadCsv } from "./lib/download-csv";
import { adminTeamPath, internalLinkHandler } from "./navigation";
import type { AppUser, JudgeGroupRecord, MentorRecord, ParticipantRecord } from "./types";

const mentorEntity = base44.entities.Mentor!;
const participantEntity = base44.entities.Participant!;
const judgeGroupEntity = base44.entities.JudgeGroup!;

interface MentorForm {
  displayName: string;
  email: string;
  phone: string;
  linkedin: string;
  details: string;
}

const emptyForm: MentorForm = { displayName: "", email: "", phone: "", linkedin: "", details: "" };

export function AdminMentorsPage({ user, onNavigate }: { user: AppUser; onNavigate: (page: AdminPage) => void }) {
  const [mentors, setMentors] = useState<MentorRecord[]>([]);
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [judgeGroups, setJudgeGroups] = useState<JudgeGroupRecord[]>([]);
  const [form, setForm] = useState<MentorForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("Loading mentors…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Mentor and assignment records are authenticated remote state.
    void reload();
  }, []);

  async function reload(preserveNotice = false) {
    try {
      const [mentorRows, participantRows, groupRows] = await Promise.all([
        mentorEntity.list("display_name", 5000),
        participantEntity.list("display_name", 5000),
        judgeGroupEntity.list("name", 5000),
      ]);
      setMentors(mentorRows as MentorRecord[]);
      setParticipants((participantRows as ParticipantRecord[]).filter(({ active }) => active !== false));
      setJudgeGroups(groupRows as JudgeGroupRecord[]);
      if (!preserveNotice) setNotice("Mentor list is current");
    } catch (caught) {
      setNotice(errorMessage(caught, "Could not load mentors"));
    }
  }

  async function saveMentor(event: FormEvent) {
    event.preventDefault();
    const displayName = form.displayName.trim();
    if (!displayName) return;
    await runMutation(async () => {
      const payload = {
        display_name: displayName,
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        linkedin: form.linkedin.trim(),
        details: form.details.trim(),
      };
      if (editingId) {
        await mentorEntity.update(editingId, payload);
        setNotice(`Updated ${displayName}`);
      } else {
        const mentorKey = form.email.trim().toLowerCase() || slugify(displayName);
        if (mentors.some(({ mentor_key }) => mentor_key === mentorKey)) throw new Error("A mentor with this email or name already exists");
        await mentorEntity.create({ mentor_key: mentorKey, ...payload });
        setNotice(`Added ${displayName}`);
      }
      resetForm();
    });
  }

  async function deleteMentor(mentor: MentorRecord) {
    if (pendingDeleteId !== mentor.id) {
      setPendingDeleteId(mentor.id);
      setNotice(`Select delete again to remove ${mentor.display_name}`);
      return;
    }
    await runMutation(async () => {
      const assigned = participants.filter(({ mentor_key }) => mentor_key === mentor.mentor_key);
      await updateParticipants(assigned, { mentor_key: "" });
      const affectedGroups = judgeGroups.filter((group) => (group.mentor_keys ?? []).includes(mentor.mentor_key));
      for (const group of affectedGroups) {
        await judgeGroupEntity.update(group.id, { mentor_keys: (group.mentor_keys ?? []).filter((key) => key !== mentor.mentor_key) });
      }
      await mentorEntity.delete(mentor.id);
      setPendingDeleteId(null);
      if (editingId === mentor.id) resetForm();
      setNotice(`Deleted ${mentor.display_name} and cleared ${assigned.length} participant assignment${assigned.length === 1 ? "" : "s"}`);
    });
  }

  async function importMentorTeams(file: File) {
    await runMutation(async () => {
      const teams = parseMentorTeamCsv(await file.text());
      const participantsByName = new Map<string, ParticipantRecord[]>();
      for (const participant of participants) {
        const key = normalizeParticipantName(participant.display_name);
        participantsByName.set(key, [...(participantsByName.get(key) ?? []), participant]);
      }

      const mentorsByKey = new Map(mentors.map((mentor) => [mentor.mentor_key, mentor]));
      const assignments: Array<{ participant: ParticipantRecord; teamKey: string; teamName: string; mentorKey: string }> = [];
      let unmatched = 0;
      for (const team of teams) {
        const existing = mentorsByKey.get(team.mentorKey);
        const payload = { mentor_key: team.mentorKey, display_name: team.mentorName, details: team.mentorDetails || existing?.details || "" };
        if (existing) await mentorEntity.update(existing.id, payload);
        if (!existing) mentorsByKey.set(team.mentorKey, await mentorEntity.create(payload) as MentorRecord);
        for (const memberName of team.memberNames) {
          const matches = participantsByName.get(normalizeParticipantName(memberName)) ?? [];
          if (matches.length !== 1) {
            unmatched += 1;
            continue;
          }
          assignments.push({ participant: matches[0]!, teamKey: team.teamKey, teamName: team.teamName, mentorKey: team.mentorKey });
        }
      }
      for (let index = 0; index < assignments.length; index += 20) {
        await Promise.all(assignments.slice(index, index + 20).map(({ participant, teamKey, teamName, mentorKey }) =>
          participantEntity.update(participant.id, { team_key: teamKey, team_name: teamName, mentor_key: mentorKey })));
      }
      setNotice(`Imported ${teams.length} teams and assigned ${new Set(assignments.map(({ participant }) => participant.id)).size} participants; ${unmatched} names need review`);
    });
  }

  async function inviteMentor(mentor: MentorRecord) {
    await runMutation(async () => {
      await navigator.clipboard.writeText(window.location.origin);
      await mentorEntity.update(mentor.id, { invited_at: new Date().toISOString() });
      setNotice(`Copied the portal link for ${mentor.display_name} — paste it to them directly`);
    });
  }

  async function copyPortalLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setNotice("Copied the mentor portal link");
    } catch {
      setNotice("Could not copy the portal link");
    }
  }

  async function runMutation(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await reload(true);
    } catch (caught) {
      setNotice(errorMessage(caught, "Mentor update failed"));
    } finally {
      setBusy(false);
    }
  }

  function editMentor(mentor: MentorRecord) {
    setEditingId(mentor.id);
    setPendingDeleteId(null);
    setForm({
      displayName: mentor.display_name,
      email: mentor.email ?? "",
      phone: mentor.phone ?? "",
      linkedin: mentor.linkedin ?? "",
      details: mentor.details ?? "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  const assignedTeams = useMemo(() => {
    const byMentor = new Map<string, Map<string, { teamName: string; members: number }>>();
    for (const participant of participants) {
      const teams = byMentor.get(participant.mentor_key) ?? new Map<string, { teamName: string; members: number }>();
      const team = teams.get(participant.team_key) ?? { teamName: participant.team_name || participant.team_key, members: 0 };
      team.members += 1;
      teams.set(participant.team_key, team);
      byMentor.set(participant.mentor_key, teams);
    }
    return byMentor;
  }, [participants]);

  const visibleMentors = mentors.filter((mentor) => [mentor.display_name, mentor.email, mentor.phone, mentor.details]
    .some((value) => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));

  function exportMentors() {
    downloadCsv("mentors", ["Name", "Email", "Phone", "LinkedIn", "Details", "Teams", "Participants"], visibleMentors.map((mentor) => {
      const teams = [...(assignedTeams.get(mentor.mentor_key)?.values() ?? [])];
      return [
        mentor.display_name,
        mentor.email ?? "",
        mentor.phone ?? "",
        mentor.linkedin ?? "",
        mentor.details ?? "",
        teams.map(({ teamName }) => teamName).sort().join("; "),
        String(teams.reduce((total, { members }) => total + members, 0)),
      ];
    }));
    setNotice(`Exported ${visibleMentors.length} mentor${visibleMentors.length === 1 ? "" : "s"} as CSV`);
  }

  return (
    <main className="admin-shell">
      <AdminHeader activePage="mentors" user={user} onNavigate={onNavigate} />
      <section className="directory-intro">
        <div><p className="section-kicker">People</p><h2>Mentor directory</h2><p>Add, update, or remove mentors. CSV import keeps the existing teams worksheet workflow.</p></div>
        <label className={`directory-import${busy ? " is-disabled" : ""}`}>
          <input type="file" accept=".csv" disabled={busy || participants.length === 0} onChange={(event) => void selectCsv(event, importMentorTeams)} />
          <span>Import teams + mentors</span><small>Mentors worksheet CSV</small>
        </label>
      </section>
      <p className="directory-notice" role="status" aria-live="polite">{notice}</p>
      <section className="directory-layout">
        <form className="directory-form" autoComplete="off" onSubmit={(event) => void saveMentor(event)}>
          <div><p className="section-kicker">{editingId ? "Edit mentor" : "New mentor"}</p><h2>{editingId ? "Update details" : "Add mentor"}</h2></div>
          <label>Name<input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
          <label>Email<input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label>Phone<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <label>LinkedIn<input type="url" placeholder="https://linkedin.com/in/..." value={form.linkedin} onChange={(event) => setForm({ ...form, linkedin: event.target.value })} /></label>
          <label>Details<textarea rows={4} value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} /></label>
          <div className="directory-form-actions"><button className="primary-button" disabled={busy}>{editingId ? "Save mentor" : "Add mentor"}</button>{editingId && <button className="secondary-button" type="button" onClick={resetForm}>Cancel</button>}</div>
        </form>
        <div className="directory-list">
          <div className="directory-toolbar"><div><p className="section-kicker">{mentors.length} mentors</p><h2>All mentors</h2></div><div className="directory-tools"><input type="search" placeholder="Search mentors" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="export-button" type="button" onClick={() => void copyPortalLink()}>Copy portal link</button><button className="export-button" type="button" disabled={!visibleMentors.length} onClick={exportMentors}>Export CSV</button></div></div>
          {visibleMentors.map((mentor) => {
            const teams = [...(assignedTeams.get(mentor.mentor_key)?.entries() ?? [])]
              .sort(([, a], [, b]) => a.teamName.localeCompare(b.teamName));
            const memberTotal = teams.reduce((total, [, { members }]) => total + members, 0);
            return <article className="mentor-row" key={mentor.id}>
              <div><strong>{mentor.display_name}</strong><small>{mentor.email || mentor.phone || "No contact details"}{mentor.invited_at ? ` · Invited ${formatInviteDate(mentor.invited_at)}` : ""}</small></div>
              <p>{mentor.details || "No mentor details"}</p>
              <div className="mentor-teams">
                <small>{teams.length} team{teams.length === 1 ? "" : "s"} · {memberTotal} participant{memberTotal === 1 ? "" : "s"}</small>
                {teams.length
                  ? <ul>{teams.map(([teamKey, { teamName, members }]) => <li key={teamKey}><a className="team-link" href={adminTeamPath(teamKey)} onClick={internalLinkHandler(adminTeamPath(teamKey))}>{teamName}</a> <small>({members})</small></li>)}</ul>
                  : <span>No teams assigned</span>}
              </div>
              <div className="directory-row-actions"><button disabled={busy} onClick={() => void inviteMentor(mentor)}>{mentor.invited_at ? "Re-invite" : "Invite"}</button><button disabled={busy} onClick={() => editMentor(mentor)}>Edit</button><button className={pendingDeleteId === mentor.id ? "confirm" : ""} disabled={busy} onClick={() => void deleteMentor(mentor)}>{pendingDeleteId === mentor.id ? "Confirm delete" : "Delete"}</button></div>
            </article>;
          })}
          {!visibleMentors.length && <p className="directory-empty">No mentors match this search.</p>}
        </div>
      </section>
    </main>
  );
}

async function updateParticipants(participants: ParticipantRecord[], data: Pick<ParticipantRecord, "mentor_key">) {
  for (let index = 0; index < participants.length; index += 20) {
    await Promise.all(participants.slice(index, index + 20).map(({ id }) => participantEntity.update(id, data)));
  }
}

async function selectCsv(event: ChangeEvent<HTMLInputElement>, importCsv: (file: File) => Promise<void>) {
  const file = event.target.files?.[0];
  if (file) await importCsv(file);
  event.target.value = "";
}

function slugify(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
}

function formatInviteDate(invitedAt: string) {
  return new Date(invitedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}
