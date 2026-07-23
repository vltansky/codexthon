interface ExistingTeam {
  team_key: string;
  team_name: string;
  mentor_key: string;
}

interface ResolveExceptionTeamInput {
  requestedTeamKey: string;
  requestedTeamName: string;
  createTeam: boolean;
  existingTeam: ExistingTeam | null;
}

export function resolveExceptionTeam({
  requestedTeamKey,
  requestedTeamName,
  createTeam,
  existingTeam,
}: ResolveExceptionTeamInput) {
  if (existingTeam) {
    return {
      teamKey: existingTeam.team_key,
      teamName: existingTeam.team_name,
      mentorKey: existingTeam.mentor_key,
    };
  }
  if (!createTeam || requestedTeamKey || !requestedTeamName) {
    throw new Error("Select an existing team or confirm creating a new one");
  }

  return {
    teamKey: slugify(requestedTeamName),
    teamName: requestedTeamName,
    mentorKey: "",
  };
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}
