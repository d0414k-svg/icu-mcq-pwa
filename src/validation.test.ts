import { describe, expect, it } from "vitest";
import { parsePastedQuestionBlock } from "./questionParsing";
import { Question } from "./types";
import { validateQuestion } from "./validation";

const baseQuestion: Question = {
  id: "Q-001",
  year: 2026,
  number: 1,
  stem: "架空問題",
  choices: [
    { key: "A", text: "A案" },
    { key: "B", text: "B案" },
    { key: "C", text: "C案" },
    { key: "D", text: "D案" }
  ],
  correctAnswers: ["A"],
  answerMode: "single",
  explanation: "架空解説",
  explanationSource: "manual",
  tags: ["架空"],
  status: "active",
  sourceType: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("question validation", () => {
  it("accepts a valid active question", () => {
    expect(validateQuestion(baseQuestion).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("rejects invalid active questions", () => {
    const issues = validateQuestion({
      ...baseQuestion,
      stem: "",
      correctAnswers: ["Z"],
      answerMode: "single"
    });

    expect(issues.some((issue) => issue.field === "stem")).toBe(true);
    expect(issues.some((issue) => issue.message.includes("選択肢に存在しません"))).toBe(true);
  });

  it("rejects multiple answers in single mode", () => {
    const issues = validateQuestion({ ...baseQuestion, correctAnswers: ["A", "B"] });
    expect(issues.some((issue) => issue.field === "answer_mode")).toBe(true);
  });

  it("warns for missing explanation and tags when requested", () => {
    const issues = validateQuestion(
      { ...baseQuestion, explanation: undefined, tags: [] },
      { warnOnMissingExplanation: true, warnOnMissingTags: true }
    );
    expect(issues.filter((issue) => issue.severity === "warning")).toHaveLength(2);
  });

  it("warns when active questions have unusual choice counts", () => {
    const tooFew = validateQuestion({
      ...baseQuestion,
      choices: baseQuestion.choices.slice(0, 3)
    });
    const tooMany = validateQuestion({
      ...baseQuestion,
      choices: [
        ...baseQuestion.choices,
        { key: "E", text: "E案" },
        { key: "F", text: "F案" },
        { key: "G", text: "G案" }
      ]
    });

    expect(tooFew.some((issue) => issue.field === "choices" && issue.severity === "warning")).toBe(true);
    expect(tooMany.some((issue) => issue.field === "choices" && issue.severity === "warning")).toBe(true);
  });
});

describe("pasted question parsing", () => {
  it("parses a pasted question block with choices, answer, explanation, and tags", () => {
    const draft = parsePastedQuestionBlock([
      "架空問題: 最も適切なものはどれか",
      "A. 選択肢A",
      "B. 選択肢B",
      "正答: A",
      "解説:",
      "自分用メモ",
      "タグ: 架空,確認"
    ].join("\n"));

    expect(draft.stem).toContain("架空問題");
    expect(draft.choices).toHaveLength(2);
    expect(draft.correctAnswers).toEqual(["A"]);
    expect(draft.explanation).toBe("自分用メモ");
    expect(draft.tags).toEqual(["架空", "確認"]);
  });
});
