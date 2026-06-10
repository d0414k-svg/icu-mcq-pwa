import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { commitImportPreview, deleteImportJobQuestions, parseChoices, parseCsvToPreview, parseStringList } from "./csv";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("CSV import", () => {
  it("parses simple choices and answers", () => {
    expect(parseChoices("A. Alpha || B. Beta")).toEqual([
      { key: "A", text: "Alpha" },
      { key: "B", text: "Beta" }
    ]);
    expect(parseStringList("A,C")).toEqual(["A", "C"]);
  });

  it("parses JSON choices and multiple answers", () => {
    expect(parseChoices('[{"key":"A","text":"Alpha"},{"key":"B","text":"Beta"}]')).toEqual([
      { key: "A", text: "Alpha" },
      { key: "B", text: "Beta" }
    ]);
    expect(parseStringList('["A","B"]')).toEqual(["A", "B"]);
  });

  it("accepts a valid single-answer row", async () => {
    const csv = [
      "question_id,year,number,stem,choices,correct_answers,answer_mode,status,explanation_source,explanation,tags",
      'Q-001,2026,1,"架空問題","A. A案 || B. B案","A",single,active,manual,"架空解説","循環,架空"'
    ].join("\n");

    const preview = await parseCsvToPreview("valid.csv", csv);

    expect(preview.summary.success).toBe(1);
    expect(preview.summary.errors).toBe(0);
    expect(preview.questions[0].answerMode).toBe("single");
  });

  it("blocks duplicate ids and impossible answers", async () => {
    const csv = [
      "question_id,year,number,stem,choices,correct_answers,answer_mode,status,explanation_source,explanation,tags",
      'Q-001,2026,1,"架空問題","A. A案 || B. B案","A",single,active,manual,"架空解説","架空"',
      'Q-001,2026,2,"重複問題","A. A案 || B. B案","C",single,active,manual,"架空解説","架空"'
    ].join("\n");

    const preview = await parseCsvToPreview("invalid.csv", csv);

    expect(preview.summary.success).toBe(1);
    expect(preview.summary.errors).toBeGreaterThanOrEqual(2);
    expect(preview.issues.some((issue) => issue.message.includes("CSV内で重複"))).toBe(true);
    expect(preview.issues.some((issue) => issue.message.includes("選択肢に存在しません"))).toBe(true);
  });

  it("warns but imports rows without explanation or tags", async () => {
    const csv = [
      "question_id,year,number,stem,choices,correct_answers,answer_mode,status,explanation_source,explanation,tags",
      'Q-002,2026,2,"架空問題","A. A案 || B. B案 || C. C案 || D. D案","B",single,active,none,"",""'
    ].join("\n");

    const preview = await parseCsvToPreview("warnings.csv", csv);

    expect(preview.summary.success).toBe(1);
    expect(preview.summary.warnings).toBe(2);
  });

  it("detects existing ID collisions in add-only mode", async () => {
    await db.questions.add({
      id: "Q-EXISTING",
      year: 2026,
      number: 1,
      stem: "既存の架空問題",
      choices: [
        { key: "A", text: "A案" },
        { key: "B", text: "B案" }
      ],
      correctAnswers: ["A"],
      answerMode: "single",
      explanationSource: "manual",
      tags: ["架空"],
      status: "active",
      sourceType: "manual",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    const csv = [
      "question_id,year,number,stem,choices,correct_answers,answer_mode,status,explanation_source,explanation,tags",
      'Q-EXISTING,2026,1,"置換用の架空問題","A. A案 || B. B案","B",single,active,manual,"架空解説","架空"'
    ].join("\n");

    const addPreview = await parseCsvToPreview("collision.csv", csv, { duplicateMode: "add" });
    const replacePreview = await parseCsvToPreview("collision.csv", csv, { duplicateMode: "replace" });
    const skipPreview = await parseCsvToPreview("collision.csv", csv, { duplicateMode: "skip" });

    expect(addPreview.summary.errors).toBe(1);
    expect(addPreview.summary.success).toBe(0);
    expect(replacePreview.summary.errors).toBe(0);
    expect(replacePreview.summary.success).toBe(1);
    expect(skipPreview.summary.errors).toBe(0);
    expect(skipPreview.summary.success).toBe(0);
    expect(skipPreview.summary.warnings).toBe(1);
  });

  it("archives imported questions without deleting study history", async () => {
    const csv = [
      "question_id,year,number,stem,choices,correct_answers,answer_mode,status,explanation_source,explanation,tags",
      'Q-DEL,2026,1,"削除用の架空問題","A. A案 || B. B案 || C. C案 || D. D案","A",single,active,manual,"架空解説","架空"'
    ].join("\n");
    const preview = await parseCsvToPreview("delete-me.csv", csv);
    const job = await commitImportPreview(preview);

    await db.questionStates.put({
      questionId: "Q-DEL",
      bookmarked: true,
      memo: "memo",
      correctCount: 1,
      wrongCount: 1,
      correctStreak: 1
    });
    await db.attempts.add({
      id: "attempt-delete",
      questionId: "Q-DEL",
      selectedAnswers: ["A"],
      isCorrect: true,
      answeredAt: "2026-01-01T00:00:00.000Z",
      mode: "practice"
    });
    await db.assets.add({
      id: "asset-delete",
      questionId: "Q-DEL",
      type: "image",
      blob: new Blob(["x"], { type: "text/plain" }),
      mimeType: "text/plain"
    });

    await expect(deleteImportJobQuestions(job)).resolves.toBe(1);

    await expect(db.questions.get("Q-DEL")).resolves.toMatchObject({ status: "deleted" });
    await expect(db.questionStates.get("Q-DEL")).resolves.toMatchObject({ questionId: "Q-DEL", wrongCount: 1 });
    await expect(db.attempts.get("attempt-delete")).resolves.toMatchObject({ questionId: "Q-DEL" });
    await expect(db.assets.get("asset-delete")).resolves.toMatchObject({ questionId: "Q-DEL" });
    await expect(db.importJobs.get(job.id)).resolves.toMatchObject({ id: job.id, questionIds: ["Q-DEL"] });
  });
});
