import { describe, expect, it } from "vitest";
import { createSessionWindow, medianElapsedMs, sessionStartForIndex, summarizeSession } from "./session";

describe("session helpers", () => {
  it("creates a finite session window", () => {
    const window = createSessionWindow(["q1", "q2", "q3", "q4"], "10");

    expect(window.items).toEqual(["q1", "q2", "q3", "q4"]);
    expect(window.startIndex).toBe(0);
    expect(window.endIndex).toBe(4);
    expect(window.hasNext).toBe(false);
  });

  it("creates a next window from a requested start index", () => {
    const window = createSessionWindow(["q1", "q2", "q3", "q4", "q5"], "10", 2);

    expect(window.items).toEqual(["q3", "q4", "q5"]);
    expect(window.startIndex).toBe(2);
    expect(window.hasNext).toBe(false);
  });

  it("finds the containing session start for a restored question", () => {
    expect(sessionStartForIndex(23, "10", 50)).toBe(20);
    expect(sessionStartForIndex(23, "20", 50)).toBe(20);
    expect(sessionStartForIndex(23, "all", 50)).toBe(0);
  });

  it("summarizes correctness and median elapsed time", () => {
    const summary = summarizeSession([
      { questionId: "q1", isCorrect: true, elapsedMs: 1000 },
      { questionId: "q2", isCorrect: false, elapsedMs: 3000 },
      { questionId: "q3", isCorrect: true, elapsedMs: 2000 }
    ]);

    expect(summary.correctCount).toBe(2);
    expect(summary.wrongCount).toBe(1);
    expect(summary.accuracy).toBeCloseTo(2 / 3);
    expect(summary.medianElapsedMs).toBe(2000);
    expect(summary.wrongQuestionIds).toEqual(["q2"]);
  });

  it("ignores attempts without elapsed time for median", () => {
    expect(
      medianElapsedMs([
        { questionId: "q1", isCorrect: true },
        { questionId: "q2", isCorrect: false, elapsedMs: 2500 }
      ])
    ).toBe(2500);
  });
});
