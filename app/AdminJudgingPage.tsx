import { useEffect, useMemo, useState, type FormEvent } from "react";

import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { AdminHeader, type AdminPage } from "./AdminHeader";
import { base44 } from "./base44Client";
import { downloadCsv } from "./lib/download-csv";
import { adminTeamPath, internalLinkHandler } from "./navigation";
import type { AppUser, JudgeGroupRecord, JudgeRecord, MentorRecord, ParticipantRecord } from "./types";

const judgeEntity = base44.entities.Judge!;
const judgeGroupEntity = base44.entities.JudgeGroup!;
const mentorEntity = base44.entities.Mentor!;
const participantEntity = base44.entities.Participant!;

interface JudgeForm {
  displayName: string;
  email: string;
  phone: string;
  linkedin: string;
  details: string;
}

interface GroupForm {
  name: string;
  details: string;
  mentorKeys: Set<string>;
  judgeKeys: Set<string>;
  teamKeys: Set<string>;
}

interface TeamOption {
  teamKey: string;
  teamName: string;
  members: number;
}

const emptyJudgeForm: JudgeForm = { displayName: "", email: "", phone: "", linkedin: "", details: "" };

const emptyGroupForm = (): GroupForm => ({ name: "", details: "", mentorKeys: new Set(), judgeKeys: new Set(), teamKeys: new Set() });

export function AdminJudgingPage({ user, onNavigate }: { user: AppUser; onNavigate: (page: AdminPage) => void }) {
  const [judges, setJudges] = useState<JudgeRecord[]>([]);
  const [groups, setGroups] = useState<JudgeGroupRecord[]>([]);
  const [mentors, setMentors] = useState<MentorRecord[]>([]);
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [notice, setNotice] = useState("Loading judging…");
  const [busy, setBusy] = useState(false);

  const [judgeForm, setJudgeForm] = useState<JudgeForm>(emptyJudgeForm);
  const [editingJudgeId, setEditingJudgeId] = useState<string | null>(null);
  const [pendingDeleteJudgeId, setPendingDeleteJudgeId] = useState<string | null>(null);
  const [judgeQuery, setJudgeQuery] = useState("");

  const [groupForm, setGroupForm] = useState<GroupForm>(emptyGroupForm);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState<string | null>(null);

  useEffect(() => {
    // Judging records are authenticated remote state.
    void reload();
  }, []);

  async function reload(preserveNotice = false) {
    try {
      const [judgeRows, groupRows, mentorRows, participantRows] = await Promise.all([
        judgeEntity.list("display_name", 5000),
        judgeGroupEntity.list("name", 5000),
        mentorEntity.list("display_name", 5000),
        participantEntity.list("display_name", 5000),
      ]);
      setJudges(judgeRows as JudgeRecord[]);
      setGroups(groupRows as JudgeGroupRecord[]);
      setMentors(mentorRows as MentorRecord[]);
      setParticipants((participantRows as ParticipantRecord[]).filter(({ active }) => active !== false));
      if (!preserveNotice) setNotice("Judging is current");
    } catch (caught) {
      setNotice(errorMessage(caught, "Could not load judging"));
    }
  }

  async function runMutation(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await reload(true);
    } catch (caught) {
      setNotice(errorMessage(caught, "Judging update failed"));
    } finally {
      setBusy(false);
    }
  }

  const teams = useMemo<TeamOption[]>(() => {
    const byKey = new Map<string, TeamOption>();
    for (const participant of participants) {
      const team = byKey.get(participant.team_key) ?? { teamKey: participant.team_key, teamName: participant.team_name || participant.team_key, members: 0 };
      team.members += 1;
      byKey.set(participant.team_key, team);
    }
    return [...byKey.values()].sort((left, right) => left.teamName.localeCompare(right.teamName));
  }, [participants]);

  const teamNameByKey = useMemo(() => new Map(teams.map((team) => [team.teamKey, team.teamName])), [teams]);
  const mentorByKey = useMemo(() => new Map(mentors.map((mentor) => [mentor.mentor_key, mentor])), [mentors]);
  const judgeByKey = useMemo(() => new Map(judges.map((judge) => [judge.judge_key, judge])), [judges]);

  async function saveJudge(event: FormEvent) {
    event.preventDefault();
    const displayName = judgeForm.displayName.trim();
    if (!displayName) return;
    await runMutation(async () => {
      const payload = {
        display_name: displayName,
        email: judgeForm.email.trim().toLowerCase(),
        phone: judgeForm.phone.trim(),
        linkedin: judgeForm.linkedin.trim(),
        details: judgeForm.details.trim(),
      };
      if (editingJudgeId) {
        await judgeEntity.update(editingJudgeId, payload);
        setNotice(`Updated ${displayName}`);
      } else {
        const judgeKey = payload.email || slugify(displayName);
        if (judges.some(({ judge_key }) => judge_key === judgeKey)) throw new Error("A judge with this email or name already exists");
        await judgeEntity.create({ judge_key: judgeKey, ...payload });
        setNotice(`Added ${displayName}`);
      }
      resetJudgeForm();
    });
  }

  async function deleteJudge(judge: JudgeRecord) {
    if (pendingDeleteJudgeId !== judge.id) {
      setPendingDeleteJudgeId(judge.id);
      setNotice(`Select delete again to remove ${judge.display_name}`);
      return;
    }
    await runMutation(async () => {
      const affected = groups.filter((group) => (group.judge_keys ?? []).includes(judge.judge_key));
      for (const group of affected) {
        await judgeGroupEntity.update(group.id, { judge_keys: (group.judge_keys ?? []).filter((key) => key !== judge.judge_key) });
      }
      await judgeEntity.delete(judge.id);
      setPendingDeleteJudgeId(null);
      if (editingJudgeId === judge.id) resetJudgeForm();
      setNotice(`Deleted ${judge.display_name} and removed them from ${affected.length} group${affected.length === 1 ? "" : "s"}`);
    });
  }

  function editJudge(judge: JudgeRecord) {
    setEditingJudgeId(judge.id);
    setPendingDeleteJudgeId(null);
    setJudgeForm({
      displayName: judge.display_name,
      email: judge.email ?? "",
      phone: judge.phone ?? "",
      linkedin: judge.linkedin ?? "",
      details: judge.details ?? "",
    });
  }

  function resetJudgeForm() {
    setEditingJudgeId(null);
    setJudgeForm(emptyJudgeForm);
  }

  async function copyJudgeLink(judge: JudgeRecord) {
    await runMutation(async () => {
      const response = unwrapBase44FunctionResponse<{ url: string }>(
        await base44.functions.invoke("judge-invite", { judgeId: judge.id }),
      );
      if (!response.url) throw new Error("Could not create the personal link");
      await navigator.clipboard.writeText(response.url);
      setNotice(`Copied ${judge.display_name}’s personal link — paste it to them directly`);
    });
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault();
    const name = groupForm.name.trim();
    if (!name) return;
    await runMutation(async () => {
      const payload = {
        name,
        details: groupForm.details.trim(),
        mentor_keys: [...groupForm.mentorKeys],
        judge_keys: [...groupForm.judgeKeys],
        team_keys: [...groupForm.teamKeys],
      };
      let groupId = editingGroupId;
      if (groupId) {
        await judgeGroupEntity.update(groupId, payload);
      } else {
        const groupKey = slugify(name);
        if (groups.some(({ group_key }) => group_key === groupKey)) throw new Error("A judge group with this name already exists");
        groupId = ((await judgeGroupEntity.create({ group_key: groupKey, ...payload })) as JudgeGroupRecord).id;
      }
      const claimed = groups.filter((group) => group.id !== groupId && (group.team_keys ?? []).some((key) => groupForm.teamKeys.has(key)));
      for (const group of claimed) {
        await judgeGroupEntity.update(group.id, { team_keys: (group.team_keys ?? []).filter((key) => !groupForm.teamKeys.has(key)) });
      }
      setNotice(editingGroupId ? `Updated ${name}` : `Created ${name}`);
      resetGroupForm();
    });
  }

  async function deleteGroup(group: JudgeGroupRecord) {
    if (pendingDeleteGroupId !== group.id) {
      setPendingDeleteGroupId(group.id);
      setNotice(`Select delete again to remove ${group.name}`);
      return;
    }
    await runMutation(async () => {
      await judgeGroupEntity.delete(group.id);
      setPendingDeleteGroupId(null);
      if (editingGroupId === group.id) resetGroupForm();
      setNotice(`Deleted ${group.name}`);
    });
  }

  function editGroup(group: JudgeGroupRecord) {
    setEditingGroupId(group.id);
    setPendingDeleteGroupId(null);
    setGroupForm({
      name: group.name,
      details: group.details ?? "",
      mentorKeys: new Set(group.mentor_keys ?? []),
      judgeKeys: new Set(group.judge_keys ?? []),
      teamKeys: new Set(group.team_keys ?? []),
    });
  }

  function resetGroupForm() {
    setEditingGroupId(null);
    setGroupForm(emptyGroupForm());
  }

  function toggleGroupKey(field: "mentorKeys" | "judgeKeys" | "teamKeys", key: string) {
    setGroupForm((current) => {
      const next = new Set(current[field]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, [field]: next };
    });
  }

  const visibleJudges = judges.filter((judge) => [judge.display_name, judge.email, judge.phone, judge.details]
    .some((value) => value?.toLocaleLowerCase().includes(judgeQuery.trim().toLocaleLowerCase())));

  function exportJudges() {
    downloadCsv("judges", ["Name", "Email", "Phone", "LinkedIn", "Details", "Groups", "Teams"], visibleJudges.map((judge) => {
      const memberOf = groups.filter((group) => (group.judge_keys ?? []).includes(judge.judge_key));
      const teamNames = new Set(memberOf.flatMap((group) => group.team_keys ?? []).map((key) => teamNameByKey.get(key) ?? key));
      return [
        judge.display_name,
        judge.email ?? "",
        judge.phone ?? "",
        judge.linkedin ?? "",
        judge.details ?? "",
        memberOf.map(({ name }) => name).sort().join("; "),
        [...teamNames].sort().join("; "),
      ];
    }));
    setNotice(`Exported ${visibleJudges.length} judge${visibleJudges.length === 1 ? "" : "s"} as CSV`);
  }

  function exportGroups() {
    downloadCsv("judge-groups", ["Group", "Details", "Mentors", "Judges", "Teams"], groups.map((group) => [
      group.name,
      group.details ?? "",
      (group.mentor_keys ?? []).map((key) => mentorByKey.get(key)?.display_name ?? key).sort().join("; "),
      (group.judge_keys ?? []).map((key) => judgeByKey.get(key)?.display_name ?? key).sort().join("; "),
      (group.team_keys ?? []).map((key) => teamNameByKey.get(key) ?? `${key} (stale)`).sort().join("; "),
    ]));
    setNotice(`Exported ${groups.length} judge group${groups.length === 1 ? "" : "s"} as CSV`);
  }

  return (
    <main className="admin-shell">
      <AdminHeader activePage="judging" user={user} onNavigate={onNavigate} />
      <section className="directory-intro">
        <div><p className="section-kicker">People</p><h2>Judge directory</h2><p>Add, update, or remove judges, then compose judge groups from mentors and judges and assign them to teams.</p></div>
      </section>
      <p className="directory-notice" role="status" aria-live="polite">{notice}</p>
      <section className="directory-layout">
        <form className="directory-form" autoComplete="off" onSubmit={(event) => void saveJudge(event)}>
          <div><p className="section-kicker">{editingJudgeId ? "Edit judge" : "New judge"}</p><h2>{editingJudgeId ? "Update details" : "Add judge"}</h2></div>
          <label>Name<input required value={judgeForm.displayName} onChange={(event) => setJudgeForm({ ...judgeForm, displayName: event.target.value })} /></label>
          <label>Email<input type="email" value={judgeForm.email} onChange={(event) => setJudgeForm({ ...judgeForm, email: event.target.value })} /></label>
          <label>Phone<input type="tel" value={judgeForm.phone} onChange={(event) => setJudgeForm({ ...judgeForm, phone: event.target.value })} /></label>
          <label>LinkedIn<input type="url" placeholder="https://linkedin.com/in/..." value={judgeForm.linkedin} onChange={(event) => setJudgeForm({ ...judgeForm, linkedin: event.target.value })} /></label>
          <label>Details<textarea rows={4} value={judgeForm.details} onChange={(event) => setJudgeForm({ ...judgeForm, details: event.target.value })} /></label>
          <div className="directory-form-actions"><button className="primary-button" disabled={busy}>{editingJudgeId ? "Save judge" : "Add judge"}</button>{editingJudgeId && <button className="secondary-button" type="button" onClick={resetJudgeForm}>Cancel</button>}</div>
        </form>
        <div className="directory-list">
          <div className="directory-toolbar"><div><p className="section-kicker">{judges.length} judges</p><h2>All judges</h2></div><div className="directory-tools"><input type="search" placeholder="Search judges" value={judgeQuery} onChange={(event) => setJudgeQuery(event.target.value)} /><button className="export-button" type="button" disabled={!visibleJudges.length} onClick={exportJudges}>Export CSV</button></div></div>
          {visibleJudges.map((judge) => {
            const memberOf = groups.filter((group) => (group.judge_keys ?? []).includes(judge.judge_key));
            return <article className="mentor-row" key={judge.id}>
              <div><strong>{judge.display_name}</strong><small>{judge.email || judge.phone || "No contact details"}{judge.invited_at ? ` · Invited ${formatInviteDate(judge.invited_at)}` : ""}</small></div>
              <p>{judge.details || "No judge details"}</p>
              <div className="mentor-teams">
                <small>{memberOf.length} group{memberOf.length === 1 ? "" : "s"}</small>
                {memberOf.length
                  ? <ul>{memberOf.map((group) => <li key={group.id}>{group.name}</li>)}</ul>
                  : <span>Not in any group</span>}
              </div>
              <div className="directory-row-actions"><button disabled={busy} onClick={() => void copyJudgeLink(judge)}>Copy link</button><button disabled={busy} onClick={() => editJudge(judge)}>Edit</button><button className={pendingDeleteJudgeId === judge.id ? "confirm" : ""} disabled={busy} onClick={() => void deleteJudge(judge)}>{pendingDeleteJudgeId === judge.id ? "Confirm delete" : "Delete"}</button></div>
            </article>;
          })}
          {!visibleJudges.length && <p className="directory-empty">No judges match this search.</p>}
        </div>
      </section>
      <section className="directory-intro">
        <div><p className="section-kicker">Judgement</p><h2>Judge groups</h2><p>Each group is a judging panel. A team belongs to at most one group; assigning it here removes it from any other group.</p></div>
      </section>
      <section className="directory-layout">
        <form className="directory-form" autoComplete="off" onSubmit={(event) => void saveGroup(event)}>
          <div><p className="section-kicker">{editingGroupId ? "Edit group" : "New group"}</p><h2>{editingGroupId ? "Update group" : "Add group"}</h2></div>
          <label>Name<input required placeholder="Room A" value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} /></label>
          <label>Details<textarea rows={3} value={groupForm.details} onChange={(event) => setGroupForm({ ...groupForm, details: event.target.value })} /></label>
          <MemberPicker legend="Mentors" options={mentors.map((mentor) => ({ key: mentor.mentor_key, label: mentor.display_name }))} selected={groupForm.mentorKeys} onToggle={(key) => toggleGroupKey("mentorKeys", key)} emptyLabel="No mentors yet" />
          <MemberPicker legend="Judges" options={judges.map((judge) => ({ key: judge.judge_key, label: judge.display_name }))} selected={groupForm.judgeKeys} onToggle={(key) => toggleGroupKey("judgeKeys", key)} emptyLabel="No judges yet" />
          <MemberPicker legend="Teams" options={teamOptionsWithStale(teams, groupForm.teamKeys)} selected={groupForm.teamKeys} onToggle={(key) => toggleGroupKey("teamKeys", key)} emptyLabel="No teams yet" />
          <div className="directory-form-actions"><button className="primary-button" disabled={busy}>{editingGroupId ? "Save group" : "Add group"}</button>{editingGroupId && <button className="secondary-button" type="button" onClick={resetGroupForm}>Cancel</button>}</div>
        </form>
        <div className="directory-list">
          <div className="directory-toolbar"><div><p className="section-kicker">{groups.length} groups</p><h2>All groups</h2></div><div className="directory-tools"><button className="export-button" type="button" disabled={!groups.length} onClick={exportGroups}>Export CSV</button></div></div>
          {groups.map((group) => {
            const memberNames = [
              ...(group.mentor_keys ?? []).map((key) => mentorByKey.get(key)?.display_name ?? key),
              ...(group.judge_keys ?? []).map((key) => judgeByKey.get(key)?.display_name ?? key),
            ];
            return <article className="mentor-row" key={group.id}>
              <div><strong>{group.name}</strong><small>{group.details || "No group details"}</small></div>
              <p>{memberNames.length ? memberNames.join(", ") : "No members yet"}</p>
              <div className="mentor-teams">
                <small>{(group.team_keys ?? []).length} team{(group.team_keys ?? []).length === 1 ? "" : "s"}</small>
                {(group.team_keys ?? []).length
                  ? <ul>{(group.team_keys ?? []).map((teamKey) => <li key={teamKey}>{teamNameByKey.has(teamKey)
                    ? <a className="team-link" href={adminTeamPath(teamKey)} onClick={internalLinkHandler(adminTeamPath(teamKey))}>{teamNameByKey.get(teamKey)}</a>
                    : <span>{teamKey} <small>(stale)</small></span>}</li>)}</ul>
                  : <span>No teams assigned</span>}
              </div>
              <div className="directory-row-actions"><button disabled={busy} onClick={() => editGroup(group)}>Edit</button><button className={pendingDeleteGroupId === group.id ? "confirm" : ""} disabled={busy} onClick={() => void deleteGroup(group)}>{pendingDeleteGroupId === group.id ? "Confirm delete" : "Delete"}</button></div>
            </article>;
          })}
          {!groups.length && <p className="directory-empty">No judge groups yet. Create the first panel.</p>}
        </div>
      </section>
    </main>
  );
}

function MemberPicker({ legend, options, selected, onToggle, emptyLabel }: {
  legend: string;
  options: Array<{ key: string; label: string }>;
  selected: Set<string>;
  onToggle: (key: string) => void;
  emptyLabel: string;
}) {
  return (
    <fieldset className="member-picker">
      <legend>{legend} · {selected.size} selected</legend>
      {options.length
        ? <div className="member-picker-options">{options.map((option) => (
          <label key={option.key}><input type="checkbox" checked={selected.has(option.key)} onChange={() => onToggle(option.key)} /><span>{option.label}</span></label>
        ))}</div>
        : <p>{emptyLabel}</p>}
    </fieldset>
  );
}

function teamOptionsWithStale(teams: TeamOption[], selected: Set<string>) {
  const known = new Set(teams.map(({ teamKey }) => teamKey));
  const stale = [...selected].filter((key) => !known.has(key));
  return [
    ...teams.map((team) => ({ key: team.teamKey, label: `${team.teamName} (${team.members})` })),
    ...stale.map((key) => ({ key, label: `${key} (stale)` })),
  ];
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
