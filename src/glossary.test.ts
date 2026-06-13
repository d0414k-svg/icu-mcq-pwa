import { describe, expect, it } from "vitest";
import { mergeGlossaryEntries, splitTextByGlossary } from "./glossary";
import { GlossaryEntry } from "./glossary";

const customEntry: GlossaryEntry = {
  id: "custom-map",
  term: "MAP",
  aliases: ["平均血圧"],
  category: "概念",
  summary: "平均動脈圧の自作用語。",
  bullets: ["循環の問題で確認する。"],
  builtIn: false,
  updatedAt: "2026-06-13T00:00:00.000Z"
};

describe("glossary", () => {
  it("merges built-in and custom glossary entries", () => {
    const entries = mergeGlossaryEntries([customEntry]);
    expect(entries.some((entry) => entry.term === "SOFA")).toBe(true);
    expect(entries.some((entry) => entry.term === "MAP")).toBe(true);
  });

  it("splits text into glossary segments using aliases", () => {
    const entries = mergeGlossaryEntries([customEntry]);
    const segments = splitTextByGlossary("敗血症でSOFAと平均血圧を確認する", entries);

    expect(segments.filter((segment) => segment.entry).map((segment) => segment.entry?.term)).toEqual([
      "敗血症",
      "SOFA",
      "MAP"
    ]);
  });

  it("does not match ascii abbreviations inside longer words", () => {
    const entries = mergeGlossaryEntries([customEntry]);
    const segments = splitTextByGlossary("sofa-likeではなくSOFAを確認する", entries);

    expect(segments.filter((segment) => segment.entry).map((segment) => segment.text)).toEqual(["SOFA"]);
  });
});
