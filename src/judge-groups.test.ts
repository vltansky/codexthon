import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface JudgeGroupSummary {
  groupKey: string;
  name: string;
  details: string;
  panel: string[];
  teams: Array<{ teamKey: string; teamName: string; members: Array<{ displayName: string; checkedIn: boolean }> }>;
}

type JudgeGroupsModule = {
  matchJudgeByEmail<T extends { email?: string }>(judges: T[], email: string): T | null;
  summarizeJudgeGroups(
    groups: unknown[],
    judgeKey: string,
    participants: unknown[],
    mentorNamesByKey: Map<string, string>,
    judgeNamesByKey: Map<string, string>,
  ): JudgeGroupSummary[];
};

async function loadModule(): Promise<JudgeGroupsModule> {
  return await import(pathToFileURL(resolve("base44/functions/judge-data/judge-groups.ts")).href) as JudgeGroupsModule;
}

test("matches judges by email ignoring case and whitespace", async () => {
  const { matchJudgeByEmail } = await loadModule();
  const judges = [{ email: "Judge@Example.com " }, { email: "other@example.com" }];
  assert.equal(matchJudgeByEmail(judges, " judge@example.com"), judges[0]);
  assert.equal(matchJudgeByEmail(judges, "missing@example.com"), null);
  assert.equal(matchJudgeByEmail(judges, ""), null);
});

test("summarizes only the judge's groups with panel co-members and active team members", async () => {
  const { summarizeJudgeGroups } = await loadModule();
  const groups = [
    { group_key: "room-a", name: "Room A", details: "Main hall", mentor_keys: ["m1"], judge_keys: ["j1", "j2"], team_keys: ["t1"] },
    { group_key: "room-b", name: "Room B", judge_keys: ["j2"], team_keys: ["t2"] },
  ];
  const participants = [
    { display_name: "Ada", team_key: "t1", team_name: "Team One", checked_in: true },
    { display_name: "Ben", team_key: "t1", team_name: "Team One", checked_in: false, active: false },
    { display_name: "Cal", team_key: "t2", team_name: "Team Two", checked_in: false },
  ];
  const summaries = summarizeJudgeGroups(
    groups,
    "j1",
    participants,
    new Map([["m1", "Mentor One"]]),
    new Map([["j1", "Judge One"], ["j2", "Judge Two"]]),
  );

  assert.equal(summaries.length, 1);
  const [summary] = summaries;
  assert.equal(summary!.name, "Room A");
  assert.deepEqual(summary!.panel, ["Mentor One", "Judge Two"]);
  assert.deepEqual(summary!.teams, [
    { teamKey: "t1", teamName: "Team One", members: [{ displayName: "Ada", checkedIn: true }] },
  ]);
});
