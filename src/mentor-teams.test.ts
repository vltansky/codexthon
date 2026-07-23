import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface MentorTeamsModule {
  matchMentorByEmail<T extends { email?: string }>(mentors: T[], email: string): T | null;
  summarizeMentorTeams(participants: Array<{
    display_name: string;
    team_key: string;
    team_name: string;
    checked_in: boolean;
    active?: boolean;
  }>): Array<{ teamKey: string; teamName: string; members: Array<{ displayName: string; checkedIn: boolean }> }>;
}

async function loadModule(): Promise<MentorTeamsModule> {
  return await import(pathToFileURL(resolve("base44/functions/mentor-data/mentor-teams.ts")).href) as MentorTeamsModule;
}

test("mentor emails match case-insensitively with surrounding whitespace ignored", async () => {
  const { matchMentorByEmail } = await loadModule();
  const mentors = [
    { mentor_key: "m-1", email: " Radia.Perlman@Example.test " },
    { mentor_key: "m-2", email: "grace@example.test" },
  ];

  assert.equal(matchMentorByEmail(mentors, "radia.perlman@example.test"), mentors[0]);
  assert.equal(matchMentorByEmail(mentors, "grace@example.test"), mentors[1]);
  assert.equal(matchMentorByEmail(mentors, "missing@example.test"), null);
});

test("mentors without an email on record never match", async () => {
  const { matchMentorByEmail } = await loadModule();

  assert.equal(matchMentorByEmail([{ mentor_key: "m-1" }, { mentor_key: "m-2", email: "" }], ""), null);
});

test("participants group into teams sorted by name, excluding inactive members", async () => {
  const { summarizeMentorTeams } = await loadModule();
  const teams = summarizeMentorTeams([
    { display_name: "Ada Lovelace", team_key: "t-compiler", team_name: "Compiler Crew", checked_in: true },
    { display_name: "Alan Turing", team_key: "t-compiler", team_name: "Compiler Crew", checked_in: false },
    { display_name: "Grace Hopper", team_key: "t-anchor", team_name: "Anchor", checked_in: true },
    { display_name: "Left Early", team_key: "t-anchor", team_name: "Anchor", checked_in: false, active: false },
  ]);

  assert.deepEqual(teams, [
    { teamKey: "t-anchor", teamName: "Anchor", members: [{ displayName: "Grace Hopper", checkedIn: true }] },
    {
      teamKey: "t-compiler",
      teamName: "Compiler Crew",
      members: [
        { displayName: "Ada Lovelace", checkedIn: true },
        { displayName: "Alan Turing", checkedIn: false },
      ],
    },
  ]);
});

test("a mentor with no assigned participants gets an empty team list", async () => {
  const { summarizeMentorTeams } = await loadModule();

  assert.deepEqual(summarizeMentorTeams([]), []);
});
