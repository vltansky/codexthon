export interface JudgeGroupTeamMember {
  displayName: string;
  checkedIn: boolean;
}

export interface JudgeGroupTeam {
  teamKey: string;
  teamName: string;
  members: JudgeGroupTeamMember[];
}

export interface JudgeGroupSummary {
  groupKey: string;
  name: string;
  details: string;
  panel: string[];
  teams: JudgeGroupTeam[];
}

interface GroupRow {
  group_key: string;
  name: string;
  details?: string;
  mentor_keys?: string[];
  judge_keys?: string[];
  team_keys?: string[];
}

interface ParticipantRow {
  display_name: string;
  team_key: string;
  team_name: string;
  checked_in: boolean;
  active?: boolean;
}

export function matchJudgeByEmail<T extends { email?: string }>(judges: T[], email: string): T | null {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  return judges.find((judge) => judge.email?.trim().toLowerCase() === wanted) ?? null;
}

export function summarizeJudgeGroups(
  groups: GroupRow[],
  judgeKey: string,
  participants: ParticipantRow[],
  mentorNamesByKey: Map<string, string>,
  judgeNamesByKey: Map<string, string>,
): JudgeGroupSummary[] {
  return groups
    .filter((group) => (group.judge_keys ?? []).includes(judgeKey))
    .map((group) => {
      const teamKeys = new Set(group.team_keys ?? []);
      const teams = new Map<string, JudgeGroupTeam>();
      for (const participant of participants) {
        if (participant.active === false || !teamKeys.has(participant.team_key)) continue;
        const team = teams.get(participant.team_key) ?? { teamKey: participant.team_key, teamName: participant.team_name, members: [] };
        team.members.push({ displayName: participant.display_name, checkedIn: participant.checked_in });
        teams.set(participant.team_key, team);
      }
      const panel = [
        ...(group.mentor_keys ?? []).map((key) => mentorNamesByKey.get(key)),
        ...(group.judge_keys ?? []).filter((key) => key !== judgeKey).map((key) => judgeNamesByKey.get(key)),
      ].filter((name): name is string => Boolean(name));
      return {
        groupKey: group.group_key,
        name: group.name,
        details: group.details ?? "",
        panel,
        teams: [...teams.values()].sort((left, right) => left.teamName.localeCompare(right.teamName)),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
