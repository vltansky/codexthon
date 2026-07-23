import { useEffect, useMemo, useState } from "react";

import { AdminHeader, type AdminPage } from "./AdminHeader";
import { base44 } from "./base44Client";
import { downloadCsv } from "./lib/download-csv";
import { adminParticipantPath, internalLinkHandler } from "./navigation";
import type { AppUser, JudgeGroupRecord, JudgeRecord, MentorRecord, ParticipantRecord, TeamInfoRecord } from "./types";

const mentorEntity = base44.entities.Mentor!;
const participantEntity = base44.entities.Participant!;
const judgeEntity = base44.entities.Judge!;
const judgeGroupEntity = base44.entities.JudgeGroup!;
const teamInfoEntity = base44.entities.TeamInfo!;

export function AdminTeamPage({ user, teamKey, onNavigate }: { user: AppUser; teamKey: string; onNavigate: (page: AdminPage) => void }) {
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [mentors, setMentors] = useState<MentorRecord[]>([]);
  const [judges, setJudges] = useState<JudgeRecord[]>([]);
  const [judgeGroups, setJudgeGroups] = useState<JudgeGroupRecord[]>([]);
  const [teamInfo, setTeamInfo] = useState<TeamInfoRecord | null>(null);
  const [notice, setNotice] = useState("Loading team…");

  useEffect(() => {
    // Team membership is derived from authenticated participant records.
    void load();
  }, [teamKey]);

  async function load() {
    try {
      const [participantRows, mentorRows, judgeRows, groupRows, teamInfoRows] = await Promise.all([
        participantEntity.list("display_name", 5000),
        mentorEntity.list("display_name", 5000),
        judgeEntity.list("display_name", 5000),
        judgeGroupEntity.list("name", 5000),
        teamInfoEntity.filter({ team_key: teamKey }, undefined, 1),
      ]);
      setParticipants((participantRows as ParticipantRecord[]).filter(({ active }) => active !== false));
      setMentors(mentorRows as MentorRecord[]);
      setJudges(judgeRows as JudgeRecord[]);
      setJudgeGroups(groupRows as JudgeGroupRecord[]);
      setTeamInfo((teamInfoRows as TeamInfoRecord[])[0] ?? null);
      setNotice("Team details are current");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not load the team");
    }
  }

  const members = useMemo(
    () => participants.filter((participant) => participant.team_key === teamKey)
      .sort((left, right) => left.display_name.localeCompare(right.display_name)),
    [participants, teamKey],
  );
  const teamName = members[0]?.team_name || teamKey;
  const teamMentors = useMemo(() => {
    const keys = new Set(members.map(({ mentor_key }) => mentor_key).filter(Boolean));
    return mentors.filter(({ mentor_key }) => keys.has(mentor_key));
  }, [members, mentors]);
  const checkedIn = members.filter(({ checked_in }) => checked_in).length;
  const judgeGroup = judgeGroups.find((group) => (group.team_keys ?? []).includes(teamKey)) ?? null;
  const panelMembers = useMemo(() => {
    if (!judgeGroup) return [];
    const mentorByKey = new Map(mentors.map((mentor) => [mentor.mentor_key, mentor]));
    const judgeByKey = new Map(judges.map((judge) => [judge.judge_key, judge]));
    return [
      ...(judgeGroup.mentor_keys ?? []).map((key) => mentorByKey.get(key)).filter((mentor) => mentor !== undefined),
      ...(judgeGroup.judge_keys ?? []).map((key) => judgeByKey.get(key)).filter((judge) => judge !== undefined),
    ];
  }, [judgeGroup, mentors, judges]);

  function exportMembers() {
    const mentorNames = teamMentors.map(({ display_name }) => display_name).join("; ");
    downloadCsv(`team-${teamKey}`, ["Name", "Email", "Team", "Mentor", "Checked In"], members.map((member) => [
      member.display_name,
      member.email,
      member.team_name,
      mentorNames,
      member.checked_in ? "yes" : "no",
    ]));
    setNotice(`Exported ${members.length} member${members.length === 1 ? "" : "s"} as CSV`);
  }

  return (
    <main className="admin-shell">
      <AdminHeader activePage="teams" user={user} onNavigate={onNavigate} />
      <section className="directory-intro">
        <div>
          <p className="section-kicker"><a className="team-back-link" href="/admin/teams" onClick={internalLinkHandler("/admin/teams")}>All teams</a></p>
          <h2>{teamName}</h2>
          <p>{[
            `${members.length} participant${members.length === 1 ? "" : "s"}`,
            `${checkedIn} checked in`,
            teamInfo?.table_number ? `Table ${teamInfo.table_number}` : "",
            teamInfo?.note ?? "",
          ].filter(Boolean).join(" · ")}</p>
        </div>
        <button className="export-button" type="button" disabled={!members.length} onClick={exportMembers}>Export CSV</button>
      </section>
      <p className="directory-notice" role="status" aria-live="polite">{notice}</p>
      <section className="teams-ledger team-page">
        <div className="team-page-mentor">
          <p className="section-kicker">Mentor{teamMentors.length === 1 ? "" : "s"}</p>
          {teamMentors.map((mentor) => (
            <article key={mentor.id}>
              <strong>{mentor.display_name}</strong>
              <small>{[mentor.email, mentor.phone].filter(Boolean).join(" · ") || "No contact details"}</small>
              {mentor.linkedin && <a href={mentor.linkedin} target="_blank" rel="noreferrer">{mentor.linkedin}</a>}
              {mentor.details && <p>{mentor.details}</p>}
            </article>
          ))}
          {!teamMentors.length && <p className="directory-empty">No mentor assigned. Assign one from the Teams page.</p>}
          <p className="section-kicker">Judging</p>
          {judgeGroup && <article>
            <strong>{judgeGroup.name}</strong>
            {judgeGroup.details && <p>{judgeGroup.details}</p>}
            <p>{panelMembers.length ? panelMembers.map(({ display_name }) => display_name).join(", ") : "No panel members yet"}</p>
          </article>}
          {!judgeGroup && <p className="directory-empty">No judge group assigned. Assign one from the Judging page.</p>}
        </div>
        <div className="team-page-members">
          <p className="section-kicker">Members</p>
          <div className="team-member-header"><span>Name</span><span>Email</span><span>Check-in</span></div>
          {members.map((member) => (
            <article className="team-member-row" key={member.id}>
              <strong><a className="team-link" href={adminParticipantPath(member.id)} onClick={internalLinkHandler(adminParticipantPath(member.id))}>{member.display_name}</a></strong>
              <span>{member.email}</span>
              <span className={member.checked_in ? "is-checked-in" : ""}>{member.checked_in ? "Checked in" : "Not checked in"}</span>
            </article>
          ))}
          {!members.length && <p className="directory-empty">No active participants belong to this team.</p>}
        </div>
      </section>
    </main>
  );
}
