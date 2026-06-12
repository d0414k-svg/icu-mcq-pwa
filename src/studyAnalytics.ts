import { Attempt, Question, QuestionState } from "./types";

export interface CategoryPerformance {
  key: string;
  label: string;
  questionCount: number;
  answeredQuestionCount: number;
  unansweredQuestionCount: number;
  attemptCount: number;
  correctAttemptCount: number;
  wrongAttemptCount: number;
  accuracy: number | null;
  bookmarkedCount: number;
  dueCount: number;
  weakQuestionIds: string[];
}

export interface WeakQuestionSummary {
  questionId: string;
  wrongCount: number;
  correctCount: number;
  correctStreak: number;
  lastCorrect?: boolean;
  reviewDueAt?: string;
  score: number;
}

function isDue(state?: QuestionState, now = Date.now()) {
  return Boolean(state?.reviewDueAt && Date.parse(state.reviewDueAt) <= now);
}

function activeQuestions(questions: Question[]) {
  return questions.filter((question) => question.status === "active");
}

function attemptsByQuestion(attempts: Attempt[]) {
  const map = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const current = map.get(attempt.questionId) ?? [];
    current.push(attempt);
    map.set(attempt.questionId, current);
  }
  return map;
}

function stateLookup(statesByQuestion: Map<string, QuestionState> | QuestionState[]) {
  return Array.isArray(statesByQuestion)
    ? new Map(statesByQuestion.map((state) => [state.questionId, state]))
    : statesByQuestion;
}

function createCategory(key: string, label: string): CategoryPerformance {
  return {
    key,
    label,
    questionCount: 0,
    answeredQuestionCount: 0,
    unansweredQuestionCount: 0,
    attemptCount: 0,
    correctAttemptCount: 0,
    wrongAttemptCount: 0,
    accuracy: null,
    bookmarkedCount: 0,
    dueCount: 0,
    weakQuestionIds: []
  };
}

function finalizeCategories(categories: Map<string, CategoryPerformance>) {
  return [...categories.values()]
    .map((category) => ({
      ...category,
      unansweredQuestionCount: category.questionCount - category.answeredQuestionCount,
      accuracy: category.attemptCount > 0 ? category.correctAttemptCount / category.attemptCount : null
    }))
    .sort(
      (left, right) =>
        right.wrongAttemptCount - left.wrongAttemptCount ||
        (left.accuracy ?? 2) - (right.accuracy ?? 2) ||
        right.questionCount - left.questionCount ||
        left.label.localeCompare(right.label, "ja")
    );
}

function addQuestionToCategory(
  category: CategoryPerformance,
  question: Question,
  questionAttempts: Attempt[],
  state?: QuestionState
) {
  category.questionCount += 1;
  category.attemptCount += questionAttempts.length;
  category.correctAttemptCount += questionAttempts.filter((attempt) => attempt.isCorrect).length;
  category.wrongAttemptCount += questionAttempts.filter((attempt) => !attempt.isCorrect).length;
  if (questionAttempts.length > 0 || state?.lastAnsweredAt) category.answeredQuestionCount += 1;
  if (state?.bookmarked) category.bookmarkedCount += 1;
  if (isDue(state)) category.dueCount += 1;
  if ((state?.wrongCount ?? 0) > 0) category.weakQuestionIds.push(question.id);
}

export function buildTagPerformance(
  questions: Question[],
  attempts: Attempt[],
  statesByQuestion: Map<string, QuestionState> | QuestionState[]
) {
  const attemptsMap = attemptsByQuestion(attempts);
  const statesMap = stateLookup(statesByQuestion);
  const categories = new Map<string, CategoryPerformance>();

  for (const question of activeQuestions(questions)) {
    const labels = question.tags.length > 0 ? question.tags : ["タグなし"];
    const questionAttempts = attemptsMap.get(question.id) ?? [];
    const state = statesMap.get(question.id);
    for (const label of labels) {
      const key = label.trim() || "タグなし";
      const category = categories.get(key) ?? createCategory(key, key);
      addQuestionToCategory(category, question, questionAttempts, state);
      categories.set(key, category);
    }
  }

  return finalizeCategories(categories);
}

export function buildYearPerformance(
  questions: Question[],
  attempts: Attempt[],
  statesByQuestion: Map<string, QuestionState> | QuestionState[]
) {
  const attemptsMap = attemptsByQuestion(attempts);
  const statesMap = stateLookup(statesByQuestion);
  const categories = new Map<string, CategoryPerformance>();

  for (const question of activeQuestions(questions)) {
    const key = String(question.year || "年度未設定");
    const category = categories.get(key) ?? createCategory(key, `${key}年`);
    addQuestionToCategory(category, question, attemptsMap.get(question.id) ?? [], statesMap.get(question.id));
    categories.set(key, category);
  }

  return finalizeCategories(categories);
}

export function buildWeakQuestionQueue(
  questions: Question[],
  statesByQuestion: Map<string, QuestionState> | QuestionState[],
  limit = 12
): WeakQuestionSummary[] {
  const statesMap = stateLookup(statesByQuestion);
  return activeQuestions(questions)
    .map((question) => {
      const state = statesMap.get(question.id);
      const wrongCount = state?.wrongCount ?? 0;
      const correctCount = state?.correctCount ?? 0;
      const correctStreak = state?.correctStreak ?? 0;
      const score =
        wrongCount * 100 +
        (state?.lastCorrect === false ? 25 : 0) +
        (isDue(state) ? 10 : 0) -
        correctStreak * 8;
      return {
        questionId: question.id,
        wrongCount,
        correctCount,
        correctStreak,
        lastCorrect: state?.lastCorrect,
        reviewDueAt: state?.reviewDueAt,
        score
      };
    })
    .filter((item) => item.wrongCount > 0)
    .sort((left, right) => right.score - left.score || right.wrongCount - left.wrongCount)
    .slice(0, limit);
}
