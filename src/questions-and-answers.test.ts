import assert from "node:assert/strict";
import test from "node:test";

import { defaultQuestionsAndAnswers } from "./default-questions-and-answers.ts";
import { parseQuestionsAndAnswers, serializeQuestionsAndAnswers } from "./questions-and-answers.ts";

test("reads legacy question and answer lines", () => {
  assert.deepEqual(parseQuestionsAndAnswers("Where? | Here.\nWhen? | Now."), [
    { question: "Where?", answer: "Here." },
    { question: "When?", answer: "Now." },
  ]);
});

test("round-trips natural questions and multiline answers", () => {
  const items = [
    { question: "Can I use Codex | API credits?", answer: "Yes.\nUse both during the event." },
    { question: "", answer: "Draft answer" },
  ];

  assert.deepEqual(parseQuestionsAndAnswers(serializeQuestionsAndAnswers(items)), items);
});

test("ships the ten event promo questions and answers", () => {
  const items = parseQuestionsAndAnswers(defaultQuestionsAndAnswers);

  assert.equal(items.length, 10);
  assert.deepEqual(items.map(({ question }) => question), [
    "When will my promo appear?",
    "How do I redeem my promo?",
    "Which ChatGPT account should I use?",
    "Does the promo upgrade my ChatGPT plan?",
    "Can I redeem it on a Free account?",
    "What happens when my $100 in credits runs out?",
    "What if my credits are missing or the promo was already redeemed?",
    "Do these credits cover API usage?",
    "How do I apply my API credits?",
    "How long are API credits valid?",
  ]);
});
