import { describe, expect, it } from "vitest";
import { accuracyLabel, questionPathLabel, questionSourceDetail } from "./questionDisplay";

describe("question display helpers", () => {
  it("builds a readable question path", () => {
    expect(questionPathLabel({ sourceType: "pdf", year: 2026, number: 12, page: 8 })).toBe(
      "PDF / 2026年 / 問12 / p.8"
    );
  });

  it("uses source note before falling back to source type", () => {
    expect(questionSourceDetail({ sourceType: "csv", sourceNote: "local.csv", page: undefined })).toBe("local.csv");
    expect(questionSourceDetail({ sourceType: "manual", sourceNote: "", page: undefined })).toBe("手入力");
  });

  it("formats accuracy from question state", () => {
    expect(accuracyLabel()).toBe("未回答");
    expect(accuracyLabel({ questionId: "Q", bookmarked: false, correctCount: 3, wrongCount: 1, correctStreak: 2 })).toBe(
      "75%"
    );
  });
});
