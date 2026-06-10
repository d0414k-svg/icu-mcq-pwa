import { describe, expect, it } from "vitest";
import { areAnswersEqual, nextReviewDueAt } from "./reviewSchedule";

describe("review scheduling", () => {
  const base = new Date("2026-01-01T00:00:00.000Z");

  it("normalizes answer order", () => {
    expect(areAnswersEqual(["C", "A"], ["A", "C"])).toBe(true);
    expect(areAnswersEqual(["A"], ["B"])).toBe(false);
  });

  it("uses the v1 spacing rules", () => {
    expect(nextReviewDueAt(false, 0, base)).toBe("2026-01-02T00:00:00.000Z");
    expect(nextReviewDueAt(true, 1, base)).toBe("2026-01-04T00:00:00.000Z");
    expect(nextReviewDueAt(true, 2, base)).toBe("2026-01-08T00:00:00.000Z");
    expect(nextReviewDueAt(true, 3, base)).toBe("2026-01-31T00:00:00.000Z");
  });
});
