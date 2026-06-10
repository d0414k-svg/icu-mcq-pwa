export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function nextReviewDueAt(isCorrect: boolean, nextCorrectStreak: number, now = new Date()) {
  if (!isCorrect) return addDays(now, 1).toISOString();
  if (nextCorrectStreak >= 3) return addDays(now, 30).toISOString();
  if (nextCorrectStreak === 2) return addDays(now, 7).toISOString();
  return addDays(now, 3).toISOString();
}

export function normalizeAnswers(answers: string[]) {
  return [...new Set(answers.map((answer) => answer.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ja")
  );
}

export function areAnswersEqual(left: string[], right: string[]) {
  const normalizedLeft = normalizeAnswers(left);
  const normalizedRight = normalizeAnswers(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((answer, index) => answer === normalizedRight[index])
  );
}
