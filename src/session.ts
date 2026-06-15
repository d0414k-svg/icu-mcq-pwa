export type SessionSizeKey = "10" | "20" | "all";

export interface SessionAttemptInput {
  questionId: string;
  isCorrect: boolean;
  elapsedMs?: number;
}

export interface SessionWindow<T> {
  items: T[];
  startIndex: number;
  endIndex: number;
  hasNext: boolean;
}

export interface SessionSummary {
  attemptCount: number;
  correctCount: number;
  wrongCount: number;
  accuracy: number | null;
  medianElapsedMs: number | null;
  wrongQuestionIds: string[];
}

export function sessionSizeToLimit(sessionSize: SessionSizeKey, totalCount: number): number {
  if (sessionSize === "all") return Math.max(totalCount, 0);
  return Math.min(Number(sessionSize), Math.max(totalCount, 0));
}

export function createSessionWindow<T>(
  items: T[],
  sessionSize: SessionSizeKey,
  requestedStartIndex = 0
): SessionWindow<T> {
  if (items.length === 0) return { items: [], startIndex: 0, endIndex: 0, hasNext: false };
  const limit = sessionSizeToLimit(sessionSize, items.length);
  const startIndex =
    sessionSize === "all" ? 0 : Math.min(Math.max(requestedStartIndex, 0), Math.max(items.length - 1, 0));
  const endIndex = Math.min(startIndex + limit, items.length);
  return {
    items: items.slice(startIndex, endIndex),
    startIndex,
    endIndex,
    hasNext: endIndex < items.length
  };
}

export function sessionStartForIndex(itemIndex: number, sessionSize: SessionSizeKey, totalCount: number): number {
  if (itemIndex < 0 || sessionSize === "all") return 0;
  const limit = sessionSizeToLimit(sessionSize, totalCount);
  if (limit <= 0) return 0;
  return Math.floor(itemIndex / limit) * limit;
}

export function medianElapsedMs(attempts: SessionAttemptInput[]): number | null {
  const values = attempts
    .map((attempt) => attempt.elapsedMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle];
  return Math.round((values[middle - 1] + values[middle]) / 2);
}

export function summarizeSession(attempts: SessionAttemptInput[]): SessionSummary {
  const correctCount = attempts.filter((attempt) => attempt.isCorrect).length;
  const wrongQuestionIds = attempts.filter((attempt) => !attempt.isCorrect).map((attempt) => attempt.questionId);
  return {
    attemptCount: attempts.length,
    correctCount,
    wrongCount: wrongQuestionIds.length,
    accuracy: attempts.length > 0 ? correctCount / attempts.length : null,
    medianElapsedMs: medianElapsedMs(attempts),
    wrongQuestionIds
  };
}
