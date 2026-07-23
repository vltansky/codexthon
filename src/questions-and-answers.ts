export interface QuestionAndAnswer {
  question: string;
  answer: string;
}

export function parseQuestionsAndAnswers(value: string): QuestionAndAnswer[] {
  if (!value.trim()) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!isQuestionAndAnswer(item)) return [];
      return [{ question: item.question, answer: item.answer }];
    });
  } catch {
    return parseLegacyQuestionsAndAnswers(value);
  }
}

export function serializeQuestionsAndAnswers(items: QuestionAndAnswer[]): string {
  return JSON.stringify(items.map(({ question, answer }) => ({ question, answer })));
}

function parseLegacyQuestionsAndAnswers(value: string): QuestionAndAnswer[] {
  return value.split("\n").flatMap((line) => {
    const separatorIndex = line.indexOf("|");
    if (separatorIndex === -1) return [];
    return [{
      question: line.slice(0, separatorIndex).trim(),
      answer: line.slice(separatorIndex + 1).trim(),
    }];
  });
}

function isQuestionAndAnswer(value: unknown): value is QuestionAndAnswer {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.question === "string" && typeof item.answer === "string";
}
