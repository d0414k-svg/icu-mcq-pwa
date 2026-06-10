import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createBackupPayload, restoreBackupPayload, validateBackupPayload } from "./backup";
import { db } from "./db";
import { BackupPayload, Question } from "./types";

const question: Question = {
  id: "Q-001",
  year: 2026,
  number: 1,
  stem: "架空問題",
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
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("backup restore", () => {
  it("rejects malformed payloads", () => {
    expect(() => validateBackupPayload({ app: "other" })).toThrow("対応していない");
  });

  it("does not clear existing data when restore validation fails", async () => {
    await db.questions.add(question);

    await expect(
      restoreBackupPayload({
        app: "icu-mcq-pwa",
        schemaVersion: 1,
        exportedAt: "2026-01-01T00:00:00.000Z",
        questions: [{ ...question, status: "active", correctAnswers: ["Z"] }],
        attempts: [],
        questionStates: [],
        assets: [],
        importJobs: [],
        settings: []
      })
    ).rejects.toThrow();

    expect(await db.questions.count()).toBe(1);
  });

  it("restores a valid payload", async () => {
    const payload: BackupPayload = {
      app: "icu-mcq-pwa",
      schemaVersion: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      questions: [question],
      attempts: [],
      questionStates: [],
      assets: [],
      importJobs: [],
      settings: []
    };

    await restoreBackupPayload(payload);
    const backup = await createBackupPayload();

    expect(backup.questions).toHaveLength(1);
    expect(backup.questions[0].id).toBe("Q-001");
  });
});
