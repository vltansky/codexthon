import { assertEquals, assertThrows } from "jsr:@std/assert@1";

import { resolveExceptionTeam } from "./exception-team.ts";

Deno.test("uses the selected existing team", () => {
  assertEquals(resolveExceptionTeam({
    requestedTeamKey: "compiler-crew",
    requestedTeamName: "",
    createTeam: false,
    existingTeam: {
      team_key: "compiler-crew",
      team_name: "Compiler Crew",
      mentor_key: "grace",
    },
  }), {
    teamKey: "compiler-crew",
    teamName: "Compiler Crew",
    mentorKey: "grace",
  });
});

Deno.test("creates a confirmed custom team without a mentor", () => {
  assertEquals(resolveExceptionTeam({
    requestedTeamKey: "",
    requestedTeamName: "Night Owls",
    createTeam: true,
    existingTeam: null,
  }), {
    teamKey: "night-owls",
    teamName: "Night Owls",
    mentorKey: "",
  });
});

Deno.test("rejects a custom team that was not confirmed", () => {
  assertThrows(
    () => resolveExceptionTeam({
      requestedTeamKey: "",
      requestedTeamName: "Night Owls",
      createTeam: false,
      existingTeam: null,
    }),
    Error,
    "Select an existing team or confirm creating a new one",
  );
});
