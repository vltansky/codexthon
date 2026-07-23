import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCheckInCsv,
  parseParticipantCsv,
  parseMentorTeamCsv,
  parsePromoBundleCsv,
  parsePromoFiles,
  serializeCsv,
} from "./csv.ts";

test("parses paired Codex and API credit links", () => {
  assert.deepEqual(
    parsePromoBundleCsv([
      "Codex Credits,API Token Credits",
      "https://chatgpt.com/p/codex-1,https://platform.openai.com/p/api-1",
    ].join("\n")),
    [{
      codexCreditUrl: "https://chatgpt.com/p/codex-1",
      apiCreditValue: "https://platform.openai.com/p/api-1",
    }],
  );
  assert.throws(
    () => parsePromoBundleCsv("Codex Credits\nhttps://chatgpt.com/p/codex-1"),
    /needs Codex Credits and API Token Credits columns/,
  );
  assert.throws(
    () => parsePromoBundleCsv("Codex Credits,API Token Credits\nPROMO-1,javascript:alert(1)"),
    /invalid promo CSV row 2/,
  );
});

test("pairs separate OpenAI allocation exports and normalizes Codex links", () => {
  const header = "requester,event,credit_type,assigned_code_or_url,newly_allocated";
  const codex = [
    header,
    "Event host,https://luma.com/event,CODEX CREDITS,chatgpt.com/codex/p/CODEX-1,true",
    "Event host,https://luma.com/event,CODEX CREDITS,https://chatgpt.com/codex/p/CODEX-2,true",
  ].join("\n");
  const api = [
    header,
    "Event host,https://luma.com/event,API,API-CODE-1,true",
    "Event host,https://luma.com/event,API,API-CODE-2,true",
  ].join("\n");

  assert.deepEqual(parsePromoFiles([api, codex]), [
    { codexCreditUrl: "https://chatgpt.com/codex/p/CODEX-1", apiCreditValue: "API-CODE-1" },
    { codexCreditUrl: "https://chatgpt.com/codex/p/CODEX-2", apiCreditValue: "API-CODE-2" },
  ]);
});

test("parses either allocation export without requiring its pair", () => {
  const header = "requester,event,credit_type,assigned_code_or_url,newly_allocated";
  const codex = `${header}\nEvent host,https://luma.com/event,CODEX CREDITS,chatgpt.com/codex/p/CODEX-1,true`;
  const api = `${header}\nEvent host,https://luma.com/event,API,API-CODE-1,true\nEvent host,https://luma.com/event,API,API-CODE-2,true`;

  assert.deepEqual(parsePromoFiles([codex]), [
    { codexCreditUrl: "https://chatgpt.com/codex/p/CODEX-1", apiCreditValue: "" },
  ]);
  assert.deepEqual(parsePromoFiles([api]), [
    { codexCreditUrl: "", apiCreditValue: "API-CODE-1" },
    { codexCreditUrl: "", apiCreditValue: "API-CODE-2" },
  ]);
});

test("rejects mismatched allocation exports", () => {
  const header = "requester,event,credit_type,assigned_code_or_url,newly_allocated";
  const codex = `${header}\nEvent host,https://luma.com/event,CODEX CREDITS,chatgpt.com/codex/p/CODEX-1,true`;
  const api = `${header}\nEvent host,https://luma.com/event,API,API-CODE-1,true\nEvent host,https://luma.com/event,API,API-CODE-2,true`;

  assert.throws(() => parsePromoFiles([api, codex]), /same number of rows/i);
});

test("parses participant, team, and mentor details", () => {
  const participants = parseParticipantCsv(
    [
      "Email,Name,Team,Mentor,Mentor Email,Mentor Phone,Mentor Details",
      "ada@example.com,Ada Lovelace,Compiler Crew,Grace Hopper,grace@example.com,+1 555 0100,Find me by the stage",
    ].join("\n"),
  );

  assert.deepEqual(participants, [
    {
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      teamKey: "compiler-crew",
      teamName: "Compiler Crew",
      mentorKey: "grace@example.com",
      mentorName: "Grace Hopper",
      mentorEmail: "grace@example.com",
      mentorPhone: "+1 555 0100",
      mentorDetails: "Find me by the stage",
    },
  ]);
});

test("parses the mentors worksheet export after its guide rows", () => {
  assert.deepEqual(
    parseMentorTeamCsv([
      "Mentor Guide,Assign mentors to teams",
      "",
      "Mentor,Team,Floor,Table,Members,Notes",
      'Grace Hopper,Compiler Crew,,,"Ada Lovelace, Alan Turing",Meet by the stage',
    ].join("\n")),
    [{
      teamKey: "compiler-crew",
      teamName: "Compiler Crew",
      mentorKey: "grace-hopper",
      mentorName: "Grace Hopper",
      mentorDetails: "Meet by the stage",
      memberNames: ["Ada Lovelace", "Alan Turing"],
    }],
  );
});

test("rejects duplicate member names across mentor teams", () => {
  assert.throws(
    () => parseMentorTeamCsv([
      "Mentor,Team,Floor,Table,Members,Notes",
      "Grace Hopper,Compiler Crew,,,Ada Lovelace,",
      "Margaret Hamilton,Moonshot,,,Ada Lovelace,",
    ].join("\n")),
    /duplicate mentor-sheet member name/i,
  );
});

test("imports only approved guests from a raw Luma export with safe team and mentor fallbacks", () => {
  const participants = parseParticipantCsv(
    [
      "guest_id,name,email,approval_status,How are you applying?,Who are you applying with?",
      'g-1,Ada Lovelace,ada@example.com,approved,With a complete team,"Grace Hopper, Alan Turing"',
      "g-2,Linus Torvalds,linus@example.com,approved,Without a team — please match me,",
      "g-3,Declined Guest,declined@example.com,declined,With a complete team,Example Team",
    ].join("\n"),
  );

  assert.deepEqual(participants, [
    {
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      teamKey: "unassigned-ada-example-com",
      teamName: "Grace Hopper, Alan Turing",
      mentorKey: "mentor-tbd",
      mentorName: "Mentor to be assigned",
      mentorEmail: "",
      mentorPhone: "",
      mentorDetails: "Mentor assignment will appear here when it is available.",
    },
    {
      email: "linus@example.com",
      displayName: "Linus Torvalds",
      teamKey: "unassigned-linus-example-com",
      teamName: "Team matching",
      mentorKey: "mentor-tbd",
      mentorName: "Mentor to be assigned",
      mentorEmail: "",
      mentorPhone: "",
      mentorDetails: "Mentor assignment will appear here when it is available.",
    },
  ]);
});

test("keeps unmatched participants isolated until a team is assigned", () => {
  const participants = parseParticipantCsv(
    [
      "name,email,approval_status,Who are you applying with?",
      "Ada Lovelace,ada@example.com,approved,",
      "Linus Torvalds,linus@example.com,approved,",
    ].join("\n"),
  );

  assert.notEqual(participants[0]?.teamKey, participants[1]?.teamKey);
});

test("does not use free-text Luma teammate answers as an access-control team key", () => {
  const participants = parseParticipantCsv(
    [
      "name,email,approval_status,Who are you applying with?",
      'Ada Lovelace,ada@example.com,approved,"Alan Turing, Grace Hopper"',
      'Linus Torvalds,linus@example.com,approved,"Alan Turing, Grace Hopper"',
    ].join("\n"),
  );

  assert.notEqual(participants[0]?.teamKey, participants[1]?.teamKey);
});

test("keeps distinct Hebrew team names in distinct teams", () => {
  const participants = parseParticipantCsv(
    [
      "name,email,Team",
      "Ada Lovelace,ada@example.com,צוות אלפא",
      "Linus Torvalds,linus@example.com,צוות בטא",
    ].join("\n"),
  );

  assert.deepEqual(participants.map((participant) => participant.teamKey), ["צוות-אלפא", "צוות-בטא"]);
});

test("does not treat an enriched participant Status column as Luma approval", () => {
  const participants = parseParticipantCsv(
    "Email,Name,Team,Mentor,Status\nada@example.com,Ada Lovelace,Compiler Crew,Grace Hopper,active",
  );

  assert.equal(participants.length, 1);
});

test("rejects a Luma export with no approved guests", () => {
  assert.throws(
    () => parseParticipantCsv("name,email,approval_status\nInvited Guest,guest@example.com,invited"),
    /no approved guests/,
  );
});

test("parses bulk check-in and check-out updates", () => {
  assert.deepEqual(
    parseCheckInCsv("Email,Checked In\nada@example.com,yes\nalan@example.com,no"),
    [
      { email: "ada@example.com", checkedIn: true },
      { email: "alan@example.com", checkedIn: false },
    ],
  );
});

test("serializes CSV with quoting that round-trips through the parsers", () => {
  const csv = serializeCsv(
    ["Email", "Name", "Checked In"],
    [
      ["ada@example.com", 'Ada "Countess" Lovelace, London', "yes"],
      ["alan@example.com", "Alan Turing\nBletchley", "no"],
    ],
  );

  assert.equal(
    csv,
    'Email,Name,Checked In\r\nada@example.com,"Ada ""Countess"" Lovelace, London",yes\r\nalan@example.com,"Alan Turing\nBletchley",no',
  );
  assert.deepEqual(parseCheckInCsv(csv), [
    { email: "ada@example.com", checkedIn: true },
    { email: "alan@example.com", checkedIn: false },
  ]);
});
