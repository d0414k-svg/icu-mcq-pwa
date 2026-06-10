import { createId, db, getOrCreateQuestionState, nowIso } from "../db";
import { areAnswersEqual, nextReviewDueAt } from "../reviewSchedule";
import { Attempt, AttemptMode, Question } from "../types";

export async function recordAttempt(
  question: Question,
  selectedAnswers: string[],
  mode: AttemptMode,
  elapsedMs?: number
): Promise<Attempt> {
  const answeredAt = nowIso();
  const isCorrect = areAnswersEqual(selectedAnswers, question.correctAnswers);
  const state = await getOrCreateQuestionState(question.id);
  const nextCorrectStreak = isCorrect ? state.correctStreak + 1 : 0;

  const attempt: Attempt = {
    id: createId("attempt"),
    questionId: question.id,
    selectedAnswers,
    isCorrect,
    answeredAt,
    elapsedMs,
    mode
  };

  await db.transaction("rw", db.attempts, db.questionStates, async () => {
    await db.attempts.add(attempt);
    await db.questionStates.put({
      ...state,
      lastAnsweredAt: answeredAt,
      lastCorrect: isCorrect,
      correctCount: state.correctCount + (isCorrect ? 1 : 0),
      wrongCount: state.wrongCount + (isCorrect ? 0 : 1),
      correctStreak: nextCorrectStreak,
      reviewDueAt: nextReviewDueAt(isCorrect, nextCorrectStreak, new Date(answeredAt))
    });
  });

  return attempt;
}
