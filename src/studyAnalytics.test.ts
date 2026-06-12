import { describe, expect, it } from "vitest";
import { buildTagPerformance, buildWeakQuestionQueue, buildYearPerformance } from "./studyAnalytics";
import { Attempt, Question, QuestionState } from "./types";

const baseQuestion = {
  number: 1,
  stem: "架空問題",
  choices: [
    { key: "A", text: "A" },
    { key: "B", text: "B" }
  ],
  correctAnswers: ["A"],
  answerMode: "single",
  explanationSource: "manual",
  status: "active",
  sourceType: "csv",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
} satisfies Omit<Question, "id" | "year" | "tags">;

function question(id: string, year: number, tags: string[]): Question {
  return { ...baseQuestion, id, year, tags };
}

function attempt(questionId: string, isCorrect: boolean): Attempt {
  return {
    id: `${questionId}-${isCorrect ? "ok" : "ng"}-${Math.random()}`,
    questionId,
    selectedAnswers: isCorrect ? ["A"] : ["B"],
    isCorrect,
    answeredAt: "2026-01-02T00:00:00.000Z",
    mode: "practice"
  };
}

function state(questionId: string, wrongCount: number, correctStreak = 0): QuestionState {
  return {
    questionId,
    bookmarked: false,
    correctCount: correctStreak,
    wrongCount,
    correctStreak,
    lastCorrect: correctStreak > 0,
    lastAnsweredAt: "2026-01-02T00:00:00.000Z"
  };
}

describe("study analytics", () => {
  it("builds tag performance with attempt-based accuracy", () => {
    const questions = [
      question("q1", 2026, ["循環"]),
      question("q2", 2026, ["循環", "呼吸"]),
      question("q3", 2025, [])
    ];
    const attempts = [attempt("q1", true), attempt("q2", false), attempt("q2", true)];
    const rows = buildTagPerformance(questions, attempts, [state("q1", 0, 1), state("q2", 1)]);

    const circulation = rows.find((row) => row.key === "循環");
    expect(circulation?.questionCount).toBe(2);
    expect(circulation?.attemptCount).toBe(3);
    expect(circulation?.correctAttemptCount).toBe(2);
    expect(circulation?.accuracy).toBeCloseTo(2 / 3);

    const untagged = rows.find((row) => row.key === "タグなし");
    expect(untagged?.questionCount).toBe(1);
    expect(untagged?.accuracy).toBeNull();
  });

  it("builds year performance and ignores inactive questions", () => {
    const active = question("q1", 2026, ["循環"]);
    const inactive: Question = { ...question("q2", 2026, ["呼吸"]), status: "draft" };
    const rows = buildYearPerformance([active, inactive], [attempt("q1", true)], [state("q1", 0, 1)]);

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("2026年");
    expect(rows[0].questionCount).toBe(1);
    expect(rows[0].accuracy).toBe(1);
  });

  it("orders weak questions by wrongness and unresolved streak", () => {
    const questions = [question("q1", 2026, ["循環"]), question("q2", 2026, ["呼吸"]), question("q3", 2026, ["感染"])];
    const rows = buildWeakQuestionQueue(questions, [
      { ...state("q1", 1), lastCorrect: false },
      state("q2", 3, 2),
      state("q3", 0, 3)
    ]);

    expect(rows.map((row) => row.questionId)).toEqual(["q2", "q1"]);
  });
});
