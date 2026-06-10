import Dexie, { Table } from "dexie";
import {
  AppSetting,
  Asset,
  Attempt,
  ImportJob,
  PracticeStats,
  Question,
  QuestionState
} from "./types";

export class McqDatabase extends Dexie {
  questions!: Table<Question, string>;
  attempts!: Table<Attempt, string>;
  questionStates!: Table<QuestionState, string>;
  assets!: Table<Asset, string>;
  importJobs!: Table<ImportJob, string>;
  settings!: Table<AppSetting, string>;

  constructor() {
    super("icu-mcq-pwa");
    this.version(1).stores({
      questions: "id, year, number, status, answerMode, updatedAt, *tags",
      attempts: "id, questionId, answeredAt, mode, isCorrect",
      questionStates: "questionId, bookmarked, reviewDueAt, lastAnsweredAt",
      assets: "id, questionId",
      importJobs: "id, importedAt, status, sourceType",
      settings: "key"
    });
  }
}

export const db = new McqDatabase();

export const nowIso = () => new Date().toISOString();

export const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const setting = await db.settings.get(key);
  return setting ? (setting.value as T) : fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value, updatedAt: nowIso() });
}

export async function getOrCreateQuestionState(questionId: string): Promise<QuestionState> {
  const existing = await db.questionStates.get(questionId);
  if (existing) return existing;

  const created: QuestionState = {
    questionId,
    bookmarked: false,
    correctCount: 0,
    wrongCount: 0,
    correctStreak: 0
  };
  await db.questionStates.put(created);
  return created;
}

export async function computeStats(): Promise<PracticeStats> {
  const [questions, states, attempts] = await Promise.all([
    db.questions.toArray(),
    db.questionStates.toArray(),
    db.attempts.toArray()
  ]);
  const activeQuestions = questions.filter((question) => question.status === "active");
  const answeredIds = new Set(attempts.map((attempt) => attempt.questionId));
  const now = Date.now();

  return {
    totalQuestions: questions.length,
    activeQuestions: activeQuestions.length,
    answeredQuestions: activeQuestions.filter((question) => answeredIds.has(question.id)).length,
    bookmarkedQuestions: states.filter((state) => state.bookmarked).length,
    dueQuestions: states.filter((state) => state.reviewDueAt && Date.parse(state.reviewDueAt) <= now)
      .length,
    attempts: attempts.length
  };
}
