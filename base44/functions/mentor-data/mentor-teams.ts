export interface MentorTeamMember {
  displayName: string;
  checkedIn: boolean;
}

export interface MentorTeam {
  teamKey: string;
  teamName: string;
  members: MentorTeamMember[];
}

interface ParticipantRow {
  display_name: string;
  team_key: string;
  team_name: string;
  checked_in: boolean;
  active?: boolean;
}

export function matchMentorByEmail<T extends { email?: string }>(mentors: T[], email: string): T | null {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  return mentors.find((mentor) => mentor.email?.trim().toLowerCase() === wanted) ?? null;
}

export function summarizeMentorTeams(participants: ParticipantRow[]): MentorTeam[] {
  const teams = new Map<string, MentorTeam>();
  for (const participant of participants) {
    if (participant.active === false) continue;
    const current = teams.get(participant.team_key) ?? { teamKey: participant.team_key, teamName: participant.team_name, members: [] };
    current.members.push({ displayName: participant.display_name, checkedIn: participant.checked_in });
    teams.set(participant.team_key, current);
  }
  return [...teams.values()].sort((left, right) => left.teamName.localeCompare(right.teamName));
}
