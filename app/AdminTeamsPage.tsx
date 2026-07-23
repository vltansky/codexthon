import { useEffect, useMemo, useState } from "react";

import { AdminHeader, type AdminPage } from "./AdminHeader";
import { base44 } from "./base44Client";
import { downloadCsv } from "./lib/download-csv";
import { adminTeamPath, internalLinkHandler } from "./navigation";
import type { AppUser, JudgeGroupRecord, MentorRecord, ParticipantRecord, TeamInfoRecord } from "./types";

const mentorEntity = base44.entities.Mentor!;
const participantEntity = base44.entities.Participant!;
const judgeGroupEntity = base44.entities.JudgeGroup!;
const teamInfoEntity = base44.entities.TeamInfo!;

interface TableDraft {
  tableNumber: string;
  note: string;
}

interface TeamSummary {
  teamKey: string;
  teamName: string;
  members: ParticipantRecord[];
  mentorKeys: Set<string>;
}

export function AdminTeamsPage({ user, onNavigate }: { user: AppUser; onNavigate: (page: AdminPage) => void }) {
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [mentors, setMentors] = useState<MentorRecord[]>([]);
  const [judgeGroups, setJudgeGroups] = useState<JudgeGroupRecord[]>([]);
  const [teamInfos, setTeamInfos] = useState<TeamInfoRecord[]>([]);
  const [draftAssignments, setDraftAssignments] = useState<Map<string, string>>(new Map());
  const [tableDrafts, setTableDrafts] = useState<Map<string, TableDraft>>(new Map());
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("Loading teams…");
  const [busyTeamKey, setBusyTeamKey] = useState<string | null>(null);
  const [busyTableTeamKey, setBusyTableTeamKey] = useState<string | null>(null);

  useEffect(() => {
    // Teams are derived from authenticated participant records.
    void reload();
  }, []);

  async function reload(preserveNotice = false) {
    try {
      const [participantRows, mentorRows, groupRows, teamInfoRows] = await Promise.all([
        participantEntity.list("team_name", 5000),
        mentorEntity.list("display_name", 5000),
        judgeGroupEntity.list("name", 5000),
        teamInfoEntity.list("team_key", 5000),
      ]);
      setParticipants((participantRows as ParticipantRecord[]).filter(({ active }) => active !== false));
      setMentors(mentorRows as MentorRecord[]);
      setJudgeGroups(groupRows as JudgeGroupRecord[]);
      setTeamInfos(teamInfoRows as TeamInfoRecord[]);
      if (!preserveNotice) setNotice("Team list is current");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not load teams");
    }
  }

  const teams = useMemo(() => summarizeTeams(participants), [participants]);
  const mentorByKey = useMemo(() => new Map(mentors.map((mentor) => [mentor.mentor_key, mentor])), [mentors]);
  const teamInfoByKey = useMemo(() => new Map(teamInfos.map((info) => [info.team_key, info])), [teamInfos]);
  const groupByTeamKey = useMemo(() => {
    const byTeam = new Map<string, JudgeGroupRecord>();
    for (const group of judgeGroups) for (const teamKey of group.team_keys ?? []) byTeam.set(teamKey, group);
    return byTeam;
  }, [judgeGroups]);
  const visibleTeams = teams.filter((team) => [team.teamName, ...team.members.map(({ display_name }) => display_name)]
    .some((value) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const assignedTeams = teams.filter(({ mentorKeys }) => mentorKeys.size === 1 && !mentorKeys.has("")).length;

  function exportTeams() {
    downloadCsv("teams", ["Team", "Table", "Table Note", "Mentor", "Judge Group", "Members"], visibleTeams.map((team) => [
      team.teamName,
      teamInfoByKey.get(team.teamKey)?.table_number ?? "",
      teamInfoByKey.get(team.teamKey)?.note ?? "",
      [...team.mentorKeys].filter(Boolean).map((mentorKey) => mentorByKey.get(mentorKey)?.display_name ?? mentorKey).sort().join("; "),
      groupByTeamKey.get(team.teamKey)?.name ?? "",
      team.members.map(({ display_name }) => display_name).join(", "),
    ]));
    setNotice(`Exported ${visibleTeams.length} team${visibleTeams.length === 1 ? "" : "s"} as CSV`);
  }

  async function assignMentor(team: TeamSummary) {
    const mentorKey = draftAssignments.get(team.teamKey) ?? currentMentorKey(team);
    setBusyTeamKey(team.teamKey);
    try {
      for (let index = 0; index < team.members.length; index += 20) {
        await Promise.all(team.members.slice(index, index + 20).map(({ id }) => participantEntity.update(id, { mentor_key: mentorKey })));
      }
      await reload(true);
      setDraftAssignments((current) => {
        const next = new Map(current);
        next.delete(team.teamKey);
        return next;
      });
      const mentorName = mentorByKey.get(mentorKey)?.display_name ?? "No mentor";
      setNotice(`${team.teamName} assigned to ${mentorName}`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not assign mentor");
    } finally {
      setBusyTeamKey(null);
    }
  }

  function currentTable(teamKey: string): TableDraft {
    const info = teamInfoByKey.get(teamKey);
    return { tableNumber: info?.table_number ?? "", note: info?.note ?? "" };
  }

  function setTableDraft(teamKey: string, patch: Partial<TableDraft>) {
    setTableDrafts((current) => new Map(current).set(teamKey, { ...(current.get(teamKey) ?? currentTable(teamKey)), ...patch }));
  }

  async function saveTable(team: TeamSummary) {
    const draft = tableDrafts.get(team.teamKey) ?? currentTable(team.teamKey);
    const data = { table_number: draft.tableNumber.trim(), note: draft.note.trim() };
    setBusyTableTeamKey(team.teamKey);
    try {
      const existing = teamInfoByKey.get(team.teamKey);
      if (existing) await teamInfoEntity.update(existing.id, data);
      if (!existing) await teamInfoEntity.create({ team_key: team.teamKey, ...data });
      await reload(true);
      setTableDrafts((current) => {
        const next = new Map(current);
        next.delete(team.teamKey);
        return next;
      });
      setNotice(data.table_number || data.note ? `${team.teamName} assigned to table ${data.table_number || data.note}` : `${team.teamName} table cleared`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not save the table");
    } finally {
      setBusyTableTeamKey(null);
    }
  }

  const tablesAssigned = teams.filter(({ teamKey }) => teamInfoByKey.get(teamKey)?.table_number).length;

  return (
    <main className="admin-shell">
      <AdminHeader activePage="teams" user={user} onNavigate={onNavigate} />
      <section className="admin-stats">
        <div><span>Teams</span><strong>{teams.length}</strong></div>
        <div><span>Assigned</span><strong>{assignedTeams}</strong></div>
        <div><span>Need mentor</span><strong>{teams.length - assignedTeams}</strong></div>
        <div><span>Tables set</span><strong>{tablesAssigned}</strong></div>
      </section>
      <section className="teams-ledger">
        <div className="directory-toolbar"><div><p className="section-kicker">Assignments</p><h2>Team list</h2></div><div className="directory-tools"><input type="search" placeholder="Search teams or members" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="export-button" type="button" disabled={!visibleTeams.length} onClick={exportTeams}>Export CSV</button></div></div>
        <p className="directory-notice" role="status" aria-live="polite">{notice}</p>
        <div className="team-table-header"><span>Team</span><span>Members</span><span>Judge group</span><span>Table</span><span>Mentor assignment</span><span /></div>
        {visibleTeams.map((team) => {
          const currentKey = currentMentorKey(team);
          const draftKey = draftAssignments.get(team.teamKey) ?? currentKey;
          const mixed = team.mentorKeys.size > 1;
          const savedTable = currentTable(team.teamKey);
          const draftTable = tableDrafts.get(team.teamKey) ?? savedTable;
          const tableDirty = draftTable.tableNumber.trim() !== savedTable.tableNumber || draftTable.note.trim() !== savedTable.note;
          return <article className="team-row" key={team.teamKey}>
            <div><strong><a className="team-link" href={adminTeamPath(team.teamKey)} onClick={internalLinkHandler(adminTeamPath(team.teamKey))}>{team.teamName}</a></strong><small>{team.members.length} participant{team.members.length === 1 ? "" : "s"}</small></div>
            <p>{team.members.map(({ display_name }) => display_name).join(", ")}</p>
            <p>{groupByTeamKey.get(team.teamKey)?.name ?? "No group"}</p>
            <div className="team-table-editor">
              <input aria-label={`Table for ${team.teamName}`} placeholder="Table" value={draftTable.tableNumber} onChange={(event) => setTableDraft(team.teamKey, { tableNumber: event.target.value })} />
              <input aria-label={`Table note for ${team.teamName}`} placeholder="Note, e.g. floor 2 near fridge" value={draftTable.note} onChange={(event) => setTableDraft(team.teamKey, { note: event.target.value })} />
              <button className="team-assign-button" disabled={busyTableTeamKey !== null || !tableDirty} onClick={() => void saveTable(team)}>{busyTableTeamKey === team.teamKey ? "Saving…" : "Save table"}</button>
            </div>
            <label><span className="sr-only">Mentor for {team.teamName}</span><select value={draftKey} onChange={(event) => setDraftAssignments((current) => new Map(current).set(team.teamKey, event.target.value))}>{mixed && <option value="__mixed" disabled>Mixed assignments</option>}<option value="">No mentor</option>{mentors.map((mentor) => <option key={mentor.id} value={mentor.mentor_key}>{mentor.display_name}</option>)}</select></label>
            <button className="team-assign-button" disabled={busyTeamKey !== null || draftKey === "__mixed" || (!mixed && draftKey === currentKey)} onClick={() => void assignMentor(team)}>{busyTeamKey === team.teamKey ? "Saving…" : "Assign"}</button>
          </article>;
        })}
        {!visibleTeams.length && <p className="directory-empty">No teams match this search.</p>}
      </section>
    </main>
  );
}

function summarizeTeams(participants: ParticipantRecord[]): TeamSummary[] {
  const teams = new Map<string, TeamSummary>();
  for (const participant of participants) {
    const current = teams.get(participant.team_key) ?? { teamKey: participant.team_key, teamName: participant.team_name, members: [], mentorKeys: new Set<string>() };
    current.members.push(participant);
    current.mentorKeys.add(participant.mentor_key);
    teams.set(participant.team_key, current);
  }
  return [...teams.values()].sort((left, right) => left.teamName.localeCompare(right.teamName));
}

function currentMentorKey(team: TeamSummary) {
  if (team.mentorKeys.size !== 1) return "__mixed";
  return [...team.mentorKeys][0] ?? "";
}
