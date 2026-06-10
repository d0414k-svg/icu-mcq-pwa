import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DatabaseBackup,
  Download,
  FileUp,
  Library,
  ListChecks,
  PlayCircle,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Shuffle,
  Trash2,
  Wand2,
  Upload
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { downloadBackup, restoreBackupFromFile } from "./backup";
import { computeStats, db, getSetting, nowIso, setSetting } from "./db";
import { commitImportPreview, deleteImportJobQuestions, parseCsvToPreview } from "./importer/csv";
import { extractQuestionDraftsFromPdf, PdfQuestionDraft } from "./pdfImport";
import { accuracyLabel, questionPathLabel, questionSourceDetail, sourceTypeLabel } from "./questionDisplay";
import { parseChoices, parsePastedQuestionBlock, parseStringList } from "./questionParsing";
import { recordAttempt } from "./services/attempts";
import { requestPersistentStorage, StorageStatus } from "./storage";
import {
  Attempt,
  AttemptMode,
  ImportDuplicateMode,
  ImportIssue,
  ImportJob,
  ImportPreview,
  PracticeStats,
  Question,
  QuestionState,
  QuestionStatus,
  SourceType
} from "./types";
import { hasValidationErrors, validateQuestion, ValidationIssue } from "./validation";

type TabKey = "practice" | "review" | "manage" | "import" | "settings";
type StudySortKey = "official" | "path" | "due" | "weak" | "unanswered" | "recent";
type ManageSortKey = "path" | "updated" | "weak" | "unanswered";

const EMPTY_STATS: PracticeStats = {
  totalQuestions: 0,
  activeQuestions: 0,
  answeredQuestions: 0,
  bookmarkedQuestions: 0,
  dueQuestions: 0,
  attempts: 0
};

const STATUS_LABEL: Record<QuestionStatus, string> = {
  active: "出題",
  excluded: "採点除外",
  deleted: "非表示",
  draft: "下書き"
};

const TAB_ITEMS: Array<{ key: TabKey; label: string; icon: typeof PlayCircle }> = [
  { key: "practice", label: "演習", icon: PlayCircle },
  { key: "review", label: "復習", icon: RotateCcw },
  { key: "manage", label: "管理", icon: Library },
  { key: "import", label: "取込", icon: FileUp },
  { key: "settings", label: "設定", icon: Settings }
];

function formatDate(value?: string) {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortDate(value?: string) {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function stateMap(states: QuestionState[]) {
  return new Map(states.map((state) => [state.questionId, state]));
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isReviewDue(state?: QuestionState) {
  return Boolean(state?.reviewDueAt && Date.parse(state.reviewDueAt) <= Date.now());
}

function answeredTotal(state?: QuestionState) {
  return (state?.correctCount ?? 0) + (state?.wrongCount ?? 0);
}

function accuracyValue(state?: QuestionState) {
  const total = answeredTotal(state);
  if (total === 0) return -1;
  return (state?.correctCount ?? 0) / total;
}

function reviewDueTime(state?: QuestionState) {
  return state?.reviewDueAt ? Date.parse(state.reviewDueAt) : Number.POSITIVE_INFINITY;
}

function sourcePriority(question: Question) {
  if (question.sourceType === "pdf") return 0;
  if (question.sourceType === "csv") return 1;
  return 2;
}

function compareQuestionPath(left: Question, right: Question) {
  return questionPathLabel(left).localeCompare(questionPathLabel(right), "ja") || left.id.localeCompare(right.id, "ja");
}

function compareOfficialFirst(left: Question, right: Question) {
  return sourcePriority(left) - sourcePriority(right) || compareQuestionPath(left, right);
}

function sortStudyQuestions(
  questions: Question[],
  statesByQuestion: Map<string, QuestionState>,
  sortKey: StudySortKey,
  shuffleSeed = ""
) {
  return [...questions].sort((left, right) => {
    if (shuffleSeed) {
      return (
        sourcePriority(left) - sourcePriority(right) ||
        stableHash(`${shuffleSeed}:${left.id}`) - stableHash(`${shuffleSeed}:${right.id}`)
      );
    }

    const leftState = statesByQuestion.get(left.id);
    const rightState = statesByQuestion.get(right.id);

    if (sortKey === "official") {
      return compareOfficialFirst(left, right);
    }
    if (sortKey === "due") {
      return reviewDueTime(leftState) - reviewDueTime(rightState) || compareOfficialFirst(left, right);
    }
    if (sortKey === "weak") {
      return (
        (rightState?.wrongCount ?? 0) - (leftState?.wrongCount ?? 0) ||
        accuracyValue(leftState) - accuracyValue(rightState) ||
        compareOfficialFirst(left, right)
      );
    }
    if (sortKey === "unanswered") {
      return answeredTotal(leftState) - answeredTotal(rightState) || compareOfficialFirst(left, right);
    }
    if (sortKey === "recent") {
      const leftTime = leftState?.lastAnsweredAt ? Date.parse(leftState.lastAnsweredAt) : 0;
      const rightTime = rightState?.lastAnsweredAt ? Date.parse(rightState.lastAnsweredAt) : 0;
      return rightTime - leftTime || compareOfficialFirst(left, right);
    }
    return compareQuestionPath(left, right);
  });
}

function explanationSourceLabel(question: Question) {
  if (question.explanationSource === "official") return "取込解説";
  if (question.explanationSource === "manual") return "手動メモ";
  return "未登録";
}

function StatPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="empty-state">
      <ClipboardList aria-hidden="true" size={28} />
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("practice");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [states, setStates] = useState<QuestionState[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [stats, setStats] = useState<PracticeStats>(EMPTY_STATS);
  const [noticeAccepted, setNoticeAccepted] = useState(true);
  const [lastBackupAt, setLastBackupAt] = useState<string | undefined>();
  const [lastRestoreAt, setLastRestoreAt] = useState<string | undefined>();
  const statesByQuestion = useMemo(() => stateMap(states), [states]);

  const refresh = async () => {
    const [nextQuestions, nextAttempts, nextStates, nextImportJobs, nextStats, accepted, backupAt, restoreAt] =
      await Promise.all([
        db.questions.orderBy("id").toArray(),
        db.attempts.orderBy("answeredAt").reverse().toArray(),
        db.questionStates.toArray(),
        db.importJobs.orderBy("importedAt").reverse().toArray(),
        computeStats(),
        getSetting("noticeAccepted", false),
        getSetting<string | undefined>("lastBackupAt", undefined),
        getSetting<string | undefined>("lastRestoreAt", undefined)
      ]);
    setQuestions(nextQuestions);
    setAttempts(nextAttempts);
    setStates(nextStates);
    setImportJobs(nextImportJobs);
    setStats(nextStats);
    setNoticeAccepted(accepted);
    setLastBackupAt(backupAt);
    setLastRestoreAt(restoreAt);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const acceptNotice = async () => {
    await setSetting("noticeAccepted", true);
    setNoticeAccepted(true);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Local Study PWA</p>
          <h1>ICU MCQ</h1>
        </div>
        <div className="header-badges" aria-label="学習状況">
          <StatPill label="問題" value={stats.activeQuestions} />
          <StatPill label="復習" value={stats.dueQuestions} />
        </div>
      </header>

      <main className="app-main">
        {activeTab === "practice" && (
          <PracticeView questions={questions} statesByQuestion={statesByQuestion} stats={stats} onRefresh={refresh} />
        )}
        {activeTab === "review" && (
          <ReviewView questions={questions} statesByQuestion={statesByQuestion} onRefresh={refresh} />
        )}
        {activeTab === "manage" && (
          <ManageView questions={questions} statesByQuestion={statesByQuestion} onRefresh={refresh} />
        )}
        {activeTab === "import" && <ImportView importJobs={importJobs} onRefresh={refresh} />}
        {activeTab === "settings" && (
          <SettingsView
            stats={stats}
            lastBackupAt={lastBackupAt}
            lastRestoreAt={lastRestoreAt}
            onRefresh={refresh}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="主要ナビゲーション">
        {TAB_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={activeTab === item.key ? "active" : ""}
              type="button"
              onClick={() => setActiveTab(item.key)}
              title={item.label}
            >
              <Icon aria-hidden="true" size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {!noticeAccepted && <NoticeModal onAccept={acceptNotice} />}
    </div>
  );
}

function NoticeModal({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="notice-title">
      <section className="modal-panel">
        <ShieldCheck aria-hidden="true" size={30} />
        <h2 id="notice-title">ローカル利用の確認</h2>
        <p>
          実際の問題文、解説本文、画像はリポジトリや外部サーバーに保存しません。ユーザーが正当に入手した資料を本人端末内で管理します。
        </p>
        <p>ブラウザの削除や端末変更でデータが失われる可能性があります。定期的にバックアップしてください。</p>
        <button className="primary full" type="button" onClick={onAccept}>
          <Check aria-hidden="true" size={18} />
          確認しました
        </button>
      </section>
    </div>
  );
}

function PracticeView({
  questions,
  statesByQuestion,
  stats,
  onRefresh
}: {
  questions: Question[];
  statesByQuestion: Map<string, QuestionState>;
  stats: PracticeStats;
  onRefresh: () => Promise<void>;
}) {
  const [year, setYear] = useState("all");
  const [tag, setTag] = useState("all");
  const [practiceFilter, setPracticeFilter] = useState("all");
  const [sortKey, setSortKey] = useState<StudySortKey>("official");
  const [shuffleSeed, setShuffleSeed] = useState("");
  const activeQuestions = questions.filter((question) => question.status === "active");
  const years = [...new Set(activeQuestions.map((question) => question.year))].sort((a, b) => b - a);
  const tags = [...new Set(activeQuestions.flatMap((question) => question.tags))].sort((a, b) =>
    a.localeCompare(b, "ja")
  );
  const filterCounts = {
    all: activeQuestions.length,
    unanswered: activeQuestions.filter((question) => !statesByQuestion.get(question.id)?.lastAnsweredAt).length,
    incorrect: activeQuestions.filter((question) => Boolean(statesByQuestion.get(question.id)?.wrongCount)).length,
    bookmarked: activeQuestions.filter((question) => Boolean(statesByQuestion.get(question.id)?.bookmarked)).length,
    due: activeQuestions.filter((question) => isReviewDue(statesByQuestion.get(question.id))).length
  };
  const filteredBeforeSort = activeQuestions.filter((question) => {
      const state = statesByQuestion.get(question.id);
      if (year !== "all" && question.year !== Number(year)) return false;
      if (tag !== "all" && !question.tags.includes(tag)) return false;
      if (practiceFilter === "unanswered") return !state?.lastAnsweredAt;
      if (practiceFilter === "incorrect") return Boolean(state?.wrongCount);
      if (practiceFilter === "bookmarked") return Boolean(state?.bookmarked);
      if (practiceFilter === "due") return isReviewDue(state);
      return true;
    });
  const filtered = sortStudyQuestions(filteredBeforeSort, statesByQuestion, sortKey, shuffleSeed);
  const hasActiveFilters =
    year !== "all" || tag !== "all" || practiceFilter !== "all" || Boolean(shuffleSeed) || sortKey !== "official";
  const resetFilters = () => {
    setYear("all");
    setTag("all");
    setPracticeFilter("all");
    setSortKey("official");
    setShuffleSeed("");
  };

  return (
    <section className="view-stack">
      <div className="metric-row">
        <StatPill label="回答済" value={`${stats.answeredQuestions}/${stats.activeQuestions}`} />
        <StatPill label="履歴" value={stats.attempts} />
        <StatPill label="ブックマーク" value={stats.bookmarkedQuestions} />
      </div>
      <div className="toolbar">
        <label>
          年度
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="all">すべて</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          タグ
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="all">すべて</option>
            {tags.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="toolbar">
        <label>
          出題
          <select value={practiceFilter} onChange={(event) => setPracticeFilter(event.target.value)}>
            <option value="all">すべての出題中 ({filterCounts.all})</option>
            <option value="unanswered">未回答 ({filterCounts.unanswered})</option>
            <option value="incorrect">誤答あり ({filterCounts.incorrect})</option>
            <option value="bookmarked">ブックマーク ({filterCounts.bookmarked})</option>
            <option value="due">復習期限 ({filterCounts.due})</option>
          </select>
        </label>
        <label>
          並び順
          <select
            value={sortKey}
            onChange={(event) => {
              setSortKey(event.target.value as StudySortKey);
              setShuffleSeed("");
            }}
          >
            <option value="official">正規問題優先</option>
            <option value="path">問題パス順</option>
            <option value="due">復習期限が近い</option>
            <option value="weak">苦手優先</option>
            <option value="unanswered">未回答優先</option>
            <option value="recent">最近解いた順</option>
          </select>
        </label>
        <button
          className={shuffleSeed ? "secondary active-soft" : "secondary"}
          type="button"
          onClick={() => {
            setShuffleSeed((current) => (current ? "" : String(Date.now())));
          }}
        >
          <Shuffle aria-hidden="true" size={17} />
          {shuffleSeed ? "通常順" : "ランダム順"}
        </button>
      </div>
      <div className="filter-summary">
        <strong>対象 {filtered.length}問</strong>
        <span>全出題 {activeQuestions.length}問</span>
        {hasActiveFilters && (
          <button className="link-button" type="button" onClick={resetFilters}>
            条件をリセット
          </button>
        )}
      </div>
      <QuestionRunner
        emptyTitle="CSVを取り込むと演習を開始できます"
        mode="practice"
        questions={filtered}
        statesByQuestion={statesByQuestion}
        onRefresh={onRefresh}
      />
    </section>
  );
}

function ReviewView({
  questions,
  statesByQuestion,
  onRefresh
}: {
  questions: Question[];
  statesByQuestion: Map<string, QuestionState>;
  onRefresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("all");
  const [sortKey, setSortKey] = useState<StudySortKey>("due");
  const activeQuestions = questions.filter((question) => question.status === "active");
  const reviewCountFor = (value: string) =>
    activeQuestions.filter((question) => {
      const state = statesByQuestion.get(question.id);
      const due = isReviewDue(state);
      const unanswered = !state?.lastAnsweredAt;
      const mistake = Boolean(state?.wrongCount);
      const bookmarked = Boolean(state?.bookmarked);
      if (value === "due") return due;
      if (value === "mistake") return mistake;
      if (value === "bookmark") return bookmarked;
      if (value === "unanswered") return unanswered;
      return due || unanswered || mistake || bookmarked;
    }).length;
  const reviewQuestionsBeforeSort = activeQuestions.filter((question) => {
      const state = statesByQuestion.get(question.id);
      const due = isReviewDue(state);
      const unanswered = !state?.lastAnsweredAt;
      const mistake = Boolean(state?.wrongCount);
      const bookmarked = Boolean(state?.bookmarked);
      if (filter === "due") return due;
      if (filter === "mistake") return mistake;
      if (filter === "bookmark") return bookmarked;
      if (filter === "unanswered") return unanswered;
      return due || unanswered || mistake || bookmarked;
    });
  const reviewQuestions = sortStudyQuestions(reviewQuestionsBeforeSort, statesByQuestion, sortKey);

  return (
    <section className="view-stack">
      <div className="segmented-control" role="tablist" aria-label="復習フィルター">
        {[
          ["all", "全て"],
          ["due", "期限"],
          ["mistake", "誤答"],
          ["bookmark", "保存"],
          ["unanswered", "未答"]
        ].map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? "active" : ""}
            type="button"
            onClick={() => setFilter(value)}
          >
            {label} {reviewCountFor(value)}
          </button>
        ))}
      </div>
      <div className="toolbar compact-toolbar">
        <label>
          復習順
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as StudySortKey)}>
            <option value="due">復習期限が近い</option>
            <option value="weak">苦手優先</option>
            <option value="unanswered">未回答優先</option>
            <option value="recent">最近解いた順</option>
            <option value="path">問題パス順</option>
          </select>
        </label>
        <div className="filter-summary inline-summary">
          <strong>対象 {reviewQuestions.length}問</strong>
          <span>出題中 {activeQuestions.length}問</span>
        </div>
      </div>
      <QuestionRunner
        emptyTitle="復習対象はありません"
        mode="review"
        questions={reviewQuestions}
        statesByQuestion={statesByQuestion}
        onRefresh={onRefresh}
      />
    </section>
  );
}

function QuestionRunner({
  questions,
  statesByQuestion,
  mode,
  emptyTitle,
  onRefresh
}: {
  questions: Question[];
  statesByQuestion: Map<string, QuestionState>;
  mode: AttemptMode;
  emptyTitle: string;
  onRefresh: () => Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<Attempt | null>(null);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
  const feedbackRef = useRef<HTMLElement | null>(null);
  const questionSetKey = useMemo(() => questions.map((item) => item.id).join("|"), [questions]);
  const question = questions[index];
  const questionState = question ? statesByQuestion.get(question.id) : undefined;
  const answerVisible = Boolean(result) || answerRevealed;

  useEffect(() => {
    setIndex(0);
    setSelectedAnswers([]);
    setResult(null);
    setAnswerRevealed(false);
    setSubmitting(false);
    setQuestionStartedAt(Date.now());
  }, [questionSetKey, mode]);

  useEffect(() => {
    setSelectedAnswers([]);
    setResult(null);
    setAnswerRevealed(false);
    setSubmitting(false);
    setQuestionStartedAt(Date.now());
  }, [question?.id]);

  useEffect(() => {
    if (!answerVisible || !question) return;
    window.setTimeout(() => {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, [answerVisible, question?.id]);

  if (!question) return <EmptyState title={emptyTitle} />;

  const answeredInSet = questions.filter((item) => statesByQuestion.get(item.id)?.lastAnsweredAt).length;
  const progressPercent = questions.length > 0 ? Math.round(((index + 1) / questions.length) * 100) : 0;
  const correctCount = questionState?.correctCount ?? 0;
  const wrongCount = questionState?.wrongCount ?? 0;
  const lastAnsweredText = questionState?.lastAnsweredAt ? formatShortDate(questionState.lastAnsweredAt) : "未回答";
  const memoStatus = questionState?.memo?.trim() ? "あり" : "なし";
  const hasExplanation = Boolean(question.explanation?.trim());
  const requiredAnswerCount = question.correctAnswers.length;
  const isMultipleAnswer = question.answerMode === "multiple";
  const choiceInstruction = isMultipleAnswer
    ? `正答は${requiredAnswerCount}個・${requiredAnswerCount}個選択`
    : "1つ選択";
  const selectedCountLabel = isMultipleAnswer ? `選択中 ${selectedAnswers.length}/${requiredAnswerCount}` : "";
  const remainingAnswerCount = Math.max(requiredAnswerCount - selectedAnswers.length, 0);
  const answerHelper = isMultipleAnswer
    ? selectedAnswers.length === requiredAnswerCount
      ? "必要数を選択済みです。回答できます。"
      : selectedAnswers.length > requiredAnswerCount
        ? `${selectedAnswers.length - requiredAnswerCount}個多く選んでいます。`
        : `あと${remainingAnswerCount}個選んでください。`
    : selectedAnswers.length === 0
      ? "選択肢を1つ選んでください。"
      : "回答できます。";
  const submitDisabled =
    selectedAnswers.length === 0 ||
    submitting ||
    Boolean(result) ||
    answerRevealed ||
    (isMultipleAnswer && selectedAnswers.length !== requiredAnswerCount);
  const correctChoices = question.choices.filter((choice) => question.correctAnswers.includes(choice.key));
  const selectedChoices = question.choices.filter((choice) => selectedAnswers.includes(choice.key));
  const reviewDueText = questionState?.reviewDueAt
    ? isReviewDue(questionState)
      ? "期限"
      : formatShortDate(questionState.reviewDueAt)
    : "未設定";

  const goToQuestion = (nextIndex: number) => {
    const bounded = Math.min(Math.max(nextIndex, 0), questions.length - 1);
    setIndex(bounded);
  };

  const toggleAnswer = (key: string) => {
    if (answerVisible) return;
    if (question.answerMode === "single") {
      setSelectedAnswers([key]);
      return;
    }
    setSelectedAnswers((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  };

  const submitAnswer = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedAnswers.length === 0 || submitting || result || answerRevealed) return;
    setSubmitting(true);
    try {
      const attempt = await recordAttempt(question, selectedAnswers, mode, Date.now() - questionStartedAt);
      setResult(attempt);
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBookmark = async () => {
    const existing = await db.questionStates.get(question.id);
    await db.questionStates.put({
      questionId: question.id,
      bookmarked: !existing?.bookmarked,
      memo: existing?.memo,
      lastAnsweredAt: existing?.lastAnsweredAt,
      lastCorrect: existing?.lastCorrect,
      correctCount: existing?.correctCount ?? 0,
      wrongCount: existing?.wrongCount ?? 0,
      correctStreak: existing?.correctStreak ?? 0,
      reviewDueAt: existing?.reviewDueAt
    });
    await onRefresh();
  };

  const saveMemo = async (memo: string) => {
    const existing = await db.questionStates.get(question.id);
    await db.questionStates.put({
      questionId: question.id,
      bookmarked: existing?.bookmarked ?? false,
      memo,
      lastAnsweredAt: existing?.lastAnsweredAt,
      lastCorrect: existing?.lastCorrect,
      correctCount: existing?.correctCount ?? 0,
      wrongCount: existing?.wrongCount ?? 0,
      correctStreak: existing?.correctStreak ?? 0,
      reviewDueAt: existing?.reviewDueAt
    });
    await onRefresh();
  };

  const nextQuestion = () => {
    setIndex((current) => (current + 1) % questions.length);
  };

  return (
    <article className="question-card">
      <div className="question-topline">
        <div>
          <span className="question-id">{question.id}</span>
          <span className="question-count">
            {index + 1}/{questions.length}
          </span>
        </div>
        <button
          className={questionState?.bookmarked ? "icon-button saved" : "icon-button"}
          type="button"
          onClick={toggleBookmark}
          title="ブックマーク"
          aria-label="ブックマーク"
        >
          <Bookmark aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="study-progress" aria-label="このセットの進捗">
        <div>
          <strong>{progressPercent}%</strong>
          <span>
            {index + 1}/{questions.length}問目・回答済 {answeredInSet}/{questions.length}
          </span>
        </div>
        <div className="progress-bar" aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="question-navigator">
        <button className="secondary" type="button" onClick={() => goToQuestion(index - 1)} disabled={index === 0}>
          <ChevronLeft aria-hidden="true" size={17} />
          前
        </button>
        <label>
          問題ジャンプ
          <select
            value={question.id}
            onChange={(event) => {
              const nextIndex = questions.findIndex((item) => item.id === event.target.value);
              if (nextIndex >= 0) goToQuestion(nextIndex);
            }}
          >
            {questions.map((item, itemIndex) => (
              <option key={item.id} value={item.id}>
                {itemIndex + 1}. {questionPathLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          type="button"
          onClick={() => goToQuestion(index + 1)}
          disabled={index >= questions.length - 1}
        >
          次
          <ChevronRight aria-hidden="true" size={17} />
        </button>
      </div>

      <section className="question-path-panel">
        <div className="section-label">問題パス</div>
        <strong>{questionPathLabel(question)}</strong>
        <small>{questionSourceDetail(question)}</small>
      </section>

      <div className="question-meta-grid">
        <StatPill label="選択肢" value={question.choices.length} />
        <StatPill label="正答数" value={question.correctAnswers.length} />
        <StatPill label="形式" value={question.answerMode === "single" ? "単一" : "複数"} />
      </div>

      <div className="study-summary-grid">
        <StatPill label="正解/誤答" value={`${correctCount}/${wrongCount}`} />
        <StatPill label="正答率" value={accuracyLabel(questionState)} />
        <StatPill label="連続正解" value={questionState?.correctStreak ?? 0} />
        <StatPill label="復習期限" value={reviewDueText} />
        <StatPill label="前回" value={lastAnsweredText} />
        <StatPill label="メモ" value={memoStatus} />
      </div>

      <section className="stem-panel">
        <div className="section-label">問題文</div>
        <p className="stem">{question.stem}</p>
      </section>

      <div className="tag-row">
        <span>{question.year}年</span>
        {questionState?.lastAnsweredAt && (
          <span>{questionState.lastCorrect ? "前回正解" : "前回不正解"}</span>
        )}
        {question.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
        {!hasExplanation && <span className="warning-tag">解説なし</span>}
        {questionState?.memo?.trim() && <span>メモあり</span>}
      </div>

      <form className="choice-list" onSubmit={submitAnswer}>
        <div className="choice-heading">
          <h2>選択肢</h2>
          <span>
            {question.choices.length}個 / {choiceInstruction}
            {selectedCountLabel ? ` / ${selectedCountLabel}` : ""}
          </span>
        </div>
        {question.choices.map((choice) => {
          const checked = selectedAnswers.includes(choice.key);
          const isCorrectChoice = answerVisible && question.correctAnswers.includes(choice.key);
          const isWrongSelected = result && checked && !question.correctAnswers.includes(choice.key);
          return (
            <label
              key={choice.key}
              className={[
                "choice-item",
                checked ? "selected" : "",
                isCorrectChoice ? "correct" : "",
                isWrongSelected ? "wrong" : ""
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                type={question.answerMode === "single" ? "radio" : "checkbox"}
                name={question.id}
                checked={checked}
                disabled={answerVisible}
                onChange={() => toggleAnswer(choice.key)}
              />
              <strong>{choice.key}</strong>
              <span>{choice.text}</span>
            </label>
          );
        })}

        <div className="action-row">
          {!answerVisible ? (
            <>
              <div className="answer-action">
                <button className="primary" type="submit" disabled={submitDisabled}>
                  <Check aria-hidden="true" size={18} />
                  {submitting ? "保存中" : "回答"}
                </button>
                <span className={submitDisabled ? "answer-helper" : "answer-helper ready"}>{answerHelper}</span>
              </div>
              {selectedAnswers.length > 0 && (
                <button className="secondary" type="button" onClick={() => setSelectedAnswers([])}>
                  <RotateCcw aria-hidden="true" size={18} />
                  選択クリア
                </button>
              )}
              {mode === "review" && (
                <button className="secondary" type="button" onClick={() => setAnswerRevealed(true)}>
                  <ListChecks aria-hidden="true" size={18} />
                  採点なしで答えを見る
                </button>
              )}
            </>
          ) : (
            <button className="primary" type="button" onClick={nextQuestion}>
              <PlayCircle aria-hidden="true" size={18} />
              次へ
            </button>
          )}
        </div>
      </form>

      {answerVisible && (
        <section
          ref={feedbackRef}
          className={result ? (result.isCorrect ? "feedback correct" : "feedback wrong") : "feedback reveal"}
        >
          <div className="feedback-head">
            <h2>{result ? (result.isCorrect ? "正解" : "不正解") : "答え確認"}</h2>
            <strong>正答 {question.correctAnswers.length}個</strong>
          </div>
          {result && (
            <div className="answer-block">
              <div className="section-label">あなたの回答</div>
              {selectedChoices.length > 0 ? (
                <ul className="answer-list">
                  {selectedChoices.map((choice) => (
                    <li key={choice.key}>
                      <strong>{choice.key}</strong>
                      <span>{choice.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="explanation-text muted">未選択</p>
              )}
            </div>
          )}
          <div className="answer-block">
            <div className="section-label">正答</div>
            <ul className="answer-list">
              {correctChoices.map((choice) => (
                <li key={choice.key}>
                  <strong>{choice.key}</strong>
                  <span>{choice.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="explanation-block">
            <div className="section-label">解説</div>
            <div className="explanation-meta">
              <span>{explanationSourceLabel(question)}</span>
              {question.sourceNote && <span>{question.sourceNote}</span>}
            </div>
            <p className={question.explanation ? "explanation-text" : "explanation-text muted"}>
              {question.explanation || "解説未登録"}
            </p>
          </div>
          <button className="primary full" type="button" onClick={nextQuestion}>
            <PlayCircle aria-hidden="true" size={18} />
            次の問題へ
          </button>
        </section>
      )}

      <MemoBox initialValue={questionState?.memo ?? ""} onSave={saveMemo} />
    </article>
  );
}

function MemoBox({ initialValue, onSave }: { initialValue: string; onSave: (memo: string) => Promise<void> }) {
  const [memo, setMemo] = useState(initialValue);
  useEffect(() => setMemo(initialValue), [initialValue]);
  const dirty = memo !== initialValue;

  return (
    <section className="memo-box">
      <label>
        メモ
        <textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} />
      </label>
      <div className="memo-actions">
        <button className="secondary" type="button" onClick={() => void onSave(memo)} disabled={!dirty}>
          <Save aria-hidden="true" size={16} />
          保存
        </button>
        <span className={dirty ? "answer-helper" : "answer-helper ready"}>{dirty ? "未保存のメモがあります" : "メモ保存済み"}</span>
      </div>
    </section>
  );
}

function ManageView({
  questions,
  statesByQuestion,
  onRefresh
}: {
  questions: Question[];
  statesByQuestion: Map<string, QuestionState>;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<QuestionStatus | "all">("all");
  const [manageSort, setManageSort] = useState<ManageSortKey>("path");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedQuestion = questions.find((question) => question.id === selectedId) ?? questions[0];
  const filtered = questions
    .filter((question) => {
      const haystack = `${question.id} ${questionPathLabel(question)} ${question.sourceNote ?? ""} ${question.stem} ${question.tags.join(" ")}`;
      if (status !== "all" && question.status !== status) return false;
      return haystack.toLowerCase().includes(query.toLowerCase());
    })
    .sort((left, right) => {
      const leftState = statesByQuestion.get(left.id);
      const rightState = statesByQuestion.get(right.id);
      if (manageSort === "updated") return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (manageSort === "weak") {
        return (
          (rightState?.wrongCount ?? 0) - (leftState?.wrongCount ?? 0) ||
          accuracyValue(leftState) - accuracyValue(rightState) ||
          questionPathLabel(left).localeCompare(questionPathLabel(right), "ja")
        );
      }
      if (manageSort === "unanswered") {
        return answeredTotal(leftState) - answeredTotal(rightState) || questionPathLabel(left).localeCompare(questionPathLabel(right), "ja");
      }
      return questionPathLabel(left).localeCompare(questionPathLabel(right), "ja");
    });

  const createManualQuestion = async () => {
    const createdAt = nowIso();
    const id = `manual-${createdAt.slice(0, 10)}-${questions.length + 1}`;
    await db.questions.add({
      id,
      year: new Date().getFullYear(),
      number: questions.length + 1,
      stem: "",
      choices: [
        { key: "A", text: "" },
        { key: "B", text: "" }
      ],
      correctAnswers: [],
      answerMode: "single",
      explanationSource: "manual",
      tags: [],
      status: "draft",
      sourceType: "manual",
      createdAt,
      updatedAt: createdAt
    });
    setSelectedId(id);
    await onRefresh();
  };

  return (
    <section className="manage-grid">
      <div className="panel list-panel">
        <div className="toolbar">
          <label className="search-box">
            <Search aria-hidden="true" size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="検索" />
          </label>
          <label>
            状態
            <select value={status} onChange={(event) => setStatus(event.target.value as QuestionStatus | "all")}>
              <option value="all">すべて</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            並び
            <select value={manageSort} onChange={(event) => setManageSort(event.target.value as ManageSortKey)}>
              <option value="path">問題パス順</option>
              <option value="updated">更新が新しい</option>
              <option value="weak">苦手優先</option>
              <option value="unanswered">未回答優先</option>
            </select>
          </label>
        </div>
        <div className="filter-summary">
          <strong>表示 {filtered.length}問</strong>
          <span>全 {questions.length}問</span>
          {(query || status !== "all" || manageSort !== "path") && (
            <button
              className="link-button"
              type="button"
              onClick={() => {
                setQuery("");
                setStatus("all");
                setManageSort("path");
              }}
            >
              条件をリセット
            </button>
          )}
        </div>
        <button className="secondary full" type="button" onClick={createManualQuestion}>
          <ListChecks aria-hidden="true" size={17} />
          手動で追加
        </button>
        <div className="question-list" aria-label="問題一覧">
          {filtered.map((question) => {
            const state = statesByQuestion.get(question.id);
            return (
              <button
                key={question.id}
                className={question.id === selectedQuestion?.id ? "question-list-item active" : "question-list-item"}
                type="button"
                onClick={() => setSelectedId(question.id)}
              >
                <span>{question.id}</span>
                <span className="path-line">{questionPathLabel(question)}</span>
                <strong>{question.stem || "問題文未入力"}</strong>
                <small>
                  {STATUS_LABEL[question.status]} / 選択肢{question.choices.length} / 正答{question.correctAnswers.length} /
                  正答率{accuracyLabel(state)}
                </small>
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel">
        {selectedQuestion ? (
          <QuestionEditor question={selectedQuestion} onRefresh={onRefresh} />
        ) : (
          <EmptyState title="問題がありません" />
        )}
      </div>
    </section>
  );
}

function QuestionEditor({ question, onRefresh }: { question: Question; onRefresh: () => Promise<void> }) {
  const [draft, setDraft] = useState({
    ...question,
    choicesText: question.choices.map((choice) => `${choice.key}. ${choice.text}`).join(" || "),
    correctText: question.correctAnswers.join(","),
    tagsText: question.tags.join(",")
  });
  const [message, setMessage] = useState("");
  const [validationMessages, setValidationMessages] = useState<ValidationIssue[]>([]);

  useEffect(() => {
    setDraft({
      ...question,
      choicesText: question.choices.map((choice) => `${choice.key}. ${choice.text}`).join(" || "),
      correctText: question.correctAnswers.join(","),
      tagsText: question.tags.join(",")
    });
    setMessage("");
    setValidationMessages([]);
  }, [question.id]);

  const update = (key: string, value: string | number) => setDraft((current) => ({ ...current, [key]: value }));

  const applyChoiceTemplate = (count: number) => {
    if (draft.choicesText.trim() && !confirm("現在の選択肢をテンプレートで置き換えます。続行しますか？")) return;
    const keys = ["A", "B", "C", "D", "E"].slice(0, count);
    setDraft((current) => ({
      ...current,
      choicesText: keys.map((key) => `${key}. `).join(" || ")
    }));
  };

  const choicePreview = (() => {
    try {
      return parseChoices(draft.choicesText).length;
    } catch {
      return "解析不可";
    }
  })();
  const correctPreview = (() => {
    try {
      return parseStringList(draft.correctText).length;
    } catch {
      return "解析不可";
    }
  })();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const choices = parseChoices(draft.choicesText);
      const correctAnswers = parseStringList(draft.correctText);
      const tags = parseStringList(draft.tagsText);
      const nextQuestion: Question = {
        ...question,
        year: Number(draft.year),
        number: Number(draft.number),
        stem: draft.stem,
        choices,
        correctAnswers,
        answerMode: draft.answerMode,
        explanation: draft.explanation,
        explanationSource: draft.explanationSource,
        tags,
        status: draft.status,
        sourceNote: draft.sourceNote,
        sourceType: draft.sourceType as SourceType,
        page: draft.page ? Number(draft.page) : undefined,
        updatedAt: nowIso()
      };
      const issues = validateQuestion(nextQuestion, {
        warnOnMissingExplanation: true,
        warnOnMissingTags: true
      });
      setValidationMessages(issues);
      if (hasValidationErrors(issues)) {
        setMessage("入力内容にエラーがあります。修正してから保存してください。");
        return;
      }
      await db.questions.put(nextQuestion);
      setMessage("保存しました。");
      await onRefresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  return (
    <form className="editor-form" onSubmit={save}>
      <div className="editor-head">
        <div>
          <span className="question-id">{question.id}</span>
          <h2>問題編集</h2>
        </div>
        <button className="primary" type="submit">
          <Save aria-hidden="true" size={17} />
          保存
        </button>
      </div>
      <section className="question-path-panel editor-path">
        <div className="section-label">問題パス</div>
        <strong>
          {sourceTypeLabel(draft.sourceType as SourceType)} / {draft.year || "-"}年 / 問{draft.number || "-"}
          {draft.page ? ` / p.${draft.page}` : ""}
        </strong>
        <small>{draft.sourceNote?.trim() || "出典メモなし"}</small>
      </section>
      <div className="form-row">
        <label>
          年度
          <input type="number" value={draft.year} onChange={(event) => update("year", event.target.value)} />
        </label>
        <label>
          番号
          <input type="number" value={draft.number} onChange={(event) => update("number", event.target.value)} />
        </label>
      </div>
      <label>
        状態
        <select value={draft.status} onChange={(event) => update("status", event.target.value)}>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="form-row">
        <label>
          取込元
          <select value={draft.sourceType} onChange={(event) => update("sourceType", event.target.value)}>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
            <option value="manual">手入力</option>
          </select>
        </label>
        <label>
          ページ
          <input
            type="number"
            min="1"
            value={draft.page ?? ""}
            onChange={(event) => update("page", event.target.value)}
            placeholder="PDFページ"
          />
        </label>
      </div>
      <label>
        問題文
        <textarea value={draft.stem} onChange={(event) => update("stem", event.target.value)} rows={5} />
      </label>
      <label>
        選択肢
        <textarea value={draft.choicesText} onChange={(event) => update("choicesText", event.target.value)} rows={4} />
      </label>
      <div className="editor-helpers">
        <div className="filter-summary inline-summary">
          <strong>選択肢 {choicePreview}</strong>
          <span>正答 {correctPreview}</span>
        </div>
        <button className="secondary" type="button" onClick={() => applyChoiceTemplate(4)}>
          4択テンプレ
        </button>
        <button className="secondary" type="button" onClick={() => applyChoiceTemplate(5)}>
          5択テンプレ
        </button>
      </div>
      <div className="form-row">
        <label>
          解答方式
          <select value={draft.answerMode} onChange={(event) => update("answerMode", event.target.value)}>
            <option value="single">単一</option>
            <option value="multiple">複数</option>
          </select>
        </label>
        <label>
          正答
          <input value={draft.correctText} onChange={(event) => update("correctText", event.target.value)} />
        </label>
      </div>
      <label>
        タグ
        <input value={draft.tagsText} onChange={(event) => update("tagsText", event.target.value)} />
      </label>
      <label>
        解説種別
        <select value={draft.explanationSource} onChange={(event) => update("explanationSource", event.target.value)}>
          <option value="official">正当に入手した解説</option>
          <option value="manual">手動メモ</option>
          <option value="none">なし</option>
        </select>
      </label>
      <label>
        ローカル取込解説
        <textarea
          value={draft.explanation ?? ""}
          onChange={(event) => update("explanation", event.target.value)}
          rows={5}
        />
      </label>
      <label>
        出典メモ
        <input
          value={draft.sourceNote ?? ""}
          onChange={(event) => update("sourceNote", event.target.value)}
          placeholder="例: 自分のPDFファイル名 p.12"
        />
      </label>
      {validationMessages.length > 0 && (
        <div className="validation-list" aria-live="polite">
          {validationMessages.map((issue, index) => (
            <p key={`${issue.field}-${index}`} className={issue.severity}>
              <strong>{issue.severity === "error" ? "エラー" : "警告"}</strong>
              {issue.message}
            </p>
          ))}
        </div>
      )}
      {message && <p className="form-message">{message}</p>}
    </form>
  );
}

function ImportView({ importJobs, onRefresh }: { importJobs: ImportJob[]; onRefresh: () => Promise<void> }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState("");
  const [duplicateMode, setDuplicateMode] = useState<ImportDuplicateMode>("add");
  const [pasteText, setPasteText] = useState("");
  const [pasteMeta, setPasteMeta] = useState({
    id: "",
    year: String(new Date().getFullYear()),
    number: "",
    answerMode: "single" as Question["answerMode"]
  });
  const [pasteIssues, setPasteIssues] = useState<ValidationIssue[]>([]);
  const [pdfDrafts, setPdfDrafts] = useState<PdfQuestionDraft[]>([]);
  const [pdfSourceName, setPdfSourceName] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  const parseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = await parseCsvToPreview(file.name, await file.text(), { duplicateMode });
    setPreview(parsed);
    setMessage("");
  };

  const loadSample = async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}samples/fictitious_questions.csv`);
    const parsed = await parseCsvToPreview("fictitious_questions.csv", await response.text(), { duplicateMode });
    setPreview(parsed);
    setMessage("");
  };

  const commit = async () => {
    if (!preview || preview.questions.length === 0) return;
    await commitImportPreview(preview);
    setMessage(`${preview.questions.length}問を取り込みました。`);
    setPreview(null);
    await onRefresh();
  };

  const deleteImport = async (job: ImportJob) => {
    const count = job.questionIds?.length ?? 0;
    if (count === 0) {
      setMessage("この古い取込履歴には問題ID一覧がないため、一括削除できません。管理タブから個別に編集してください。");
      return;
    }
    if (
      !confirm(
        `${job.sourceName} から取り込んだ ${count}問を削除します。回答履歴、復習状態、メモ、画像も削除されます。続行しますか？`
      )
    ) {
      return;
    }
    setDeletingJobId(job.id);
    try {
      const deletedCount = await deleteImportJobQuestions(job);
      setMessage(`${job.sourceName} の取込データ ${deletedCount}問を削除しました。`);
      await onRefresh();
    } catch (error) {
      setMessage(`削除できませんでした: ${(error as Error).message}`);
    } finally {
      setDeletingJobId(null);
    }
  };

  const savePastedQuestion = async () => {
    const parsed = parsePastedQuestionBlock(pasteText);
    const now = nowIso();
    const question: Question = {
      id: pasteMeta.id.trim() || `${pasteMeta.year}-${String(pasteMeta.number || Date.now()).padStart(3, "0")}`,
      year: Number(pasteMeta.year),
      number: Number(pasteMeta.number),
      stem: parsed.stem,
      choices: parsed.choices,
      correctAnswers: parsed.correctAnswers,
      answerMode: pasteMeta.answerMode,
      explanation: parsed.explanation,
      explanationSource: parsed.explanation ? "manual" : "none",
      tags: parsed.tags,
      status: "active",
      sourceType: "manual",
      sourceNote: "端末内貼り付け取込",
      createdAt: now,
      updatedAt: now
    };
    const issues = validateQuestion(question, { warnOnMissingExplanation: true, warnOnMissingTags: true });
    setPasteIssues(issues);
    if (hasValidationErrors(issues)) {
      setMessage("貼り付け内容にエラーがあります。問題文、選択肢、正答を確認してください。");
      return;
    }
    if (await db.questions.get(question.id)) {
      setMessage("同じquestion_idが既にあります。IDを変えるか、問題管理から編集してください。");
      return;
    }
    await db.questions.add(question);
    setPasteText("");
    setPasteMeta((current) => ({ ...current, id: "", number: String(Number(current.number || 0) + 1 || "") }));
    setPasteIssues([]);
    setMessage("貼り付けた問題を保存しました。演習タブから解けます。");
    await onRefresh();
  };

  const parsePdfFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPdfBusy(true);
    setMessage("");
    try {
      const drafts = await extractQuestionDraftsFromPdf(file);
      setPdfDrafts(drafts);
      setPdfSourceName(file.name);
      setMessage(
        drafts.length > 0
          ? `${drafts.length}件の候補を抽出しました。下書きとして保存してから問題管理で確認してください。`
          : "選択肢を含む問題候補を抽出できませんでした。テキスト選択できるPDFか確認してください。"
      );
    } catch (error) {
      setPdfDrafts([]);
      setPdfSourceName(file.name);
      setMessage(`PDFを読み取れませんでした: ${(error as Error).message}`);
    } finally {
      setPdfBusy(false);
      event.target.value = "";
    }
  };

  const savePdfDrafts = async () => {
    if (pdfDrafts.length === 0) return;
    const now = nowIso();
    const existingIds = new Set((await db.questions.toArray()).map((question) => question.id));
    const questionsToAdd = pdfDrafts.map((draft, index) => {
      const baseId = `pdf-${now.slice(0, 10)}-${String(index + 1).padStart(3, "0")}`;
      let id = baseId;
      let suffix = 2;
      while (existingIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      existingIds.add(id);
      return {
        id,
        year: new Date().getFullYear(),
        number: index + 1,
        stem: draft.stem || draft.rawText,
        choices: draft.choices,
        correctAnswers: draft.correctAnswers,
        answerMode: draft.correctAnswers.length > 1 ? "multiple" : "single",
        explanation: draft.explanation,
        explanationSource: draft.explanation ? "manual" : "none",
        tags: draft.tags,
        status: "draft",
        sourceType: "pdf",
        sourceNote: `${pdfSourceName} p.${draft.sourcePage}`,
        page: draft.sourcePage,
        createdAt: now,
        updatedAt: now
      } satisfies Question;
    });
    await db.questions.bulkAdd(questionsToAdd);
    setPdfDrafts([]);
    setMessage(`${questionsToAdd.length}件を下書きとして保存しました。管理タブで確認してactiveにしてください。`);
    await onRefresh();
  };

  return (
    <section className="view-stack">
      <div className="panel import-panel">
        <h2>PDFから下書き抽出</h2>
        <p className="muted">
          自分のPDFを端末内で読み取り、選択肢を含むブロックを下書きにします。OCRには未対応です。
        </p>
        <label className="file-button">
          <Wand2 aria-hidden="true" size={18} />
          {pdfBusy ? "抽出中" : "PDFを選択"}
          <input type="file" accept="application/pdf,.pdf" onChange={parsePdfFile} disabled={pdfBusy} />
        </label>
        {pdfDrafts.length > 0 && (
          <div className="pdf-draft-list">
            <div className="summary-grid">
              <StatPill label="候補" value={pdfDrafts.length} />
              <StatPill label="元PDF" value={pdfSourceName || "未選択"} />
            </div>
            {pdfDrafts.slice(0, 5).map((draft, index) => (
              <div key={`${draft.sourcePage}-${index}`} className="pdf-draft-item">
                <strong>
                  p.{draft.sourcePage} 候補{index + 1}
                </strong>
                <p>{draft.stem || draft.rawText.slice(0, 140)}</p>
                <small>選択肢 {draft.choices.length} / 正答 {draft.correctAnswers.join(", ") || "未検出"}</small>
              </div>
            ))}
            {pdfDrafts.length > 5 && <p className="muted">ほか {pdfDrafts.length - 5} 件</p>}
            <button className="primary full" type="button" onClick={savePdfDrafts}>
              <Save aria-hidden="true" size={18} />
              すべて下書き保存
            </button>
          </div>
        )}
      </div>

      <div className="panel import-panel">
        <h2>貼り付けて1問追加</h2>
        <p className="muted">
          問題文、A. 選択肢、正答: A のような行を貼ると、端末内だけに保存します。
        </p>
        <div className="form-row">
          <label>
            question_id
            <input
              value={pasteMeta.id}
              onChange={(event) => setPasteMeta((current) => ({ ...current, id: event.target.value }))}
              placeholder="例: 2024-001"
            />
          </label>
          <label>
            年度
            <input
              type="number"
              value={pasteMeta.year}
              onChange={(event) => setPasteMeta((current) => ({ ...current, year: event.target.value }))}
            />
          </label>
          <label>
            番号
            <input
              type="number"
              value={pasteMeta.number}
              onChange={(event) => setPasteMeta((current) => ({ ...current, number: event.target.value }))}
            />
          </label>
          <label>
            解答方式
            <select
              value={pasteMeta.answerMode}
              onChange={(event) =>
                setPasteMeta((current) => ({ ...current, answerMode: event.target.value as Question["answerMode"] }))
              }
            >
              <option value="single">単一</option>
              <option value="multiple">複数</option>
            </select>
          </label>
        </div>
        <label>
          貼り付け本文
          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            rows={10}
            placeholder={"問題文\nA. 選択肢A\nB. 選択肢B\nC. 選択肢C\nD. 選択肢D\n正答: A\n解説:\n自分用メモ\nタグ: 呼吸,循環"}
          />
        </label>
        {pasteIssues.length > 0 && (
          <div className="validation-list" aria-live="polite">
            {pasteIssues.map((issue, index) => (
              <p key={`${issue.field}-${index}`} className={issue.severity}>
                <strong>{issue.severity === "error" ? "エラー" : "警告"}</strong>
                {issue.message}
              </p>
            ))}
          </div>
        )}
        <button className="primary full" type="button" onClick={savePastedQuestion} disabled={!pasteText.trim()}>
          <Save aria-hidden="true" size={18} />
          保存して演習に追加
        </button>
      </div>

      <div className="panel import-panel">
        <h2>CSVでまとめて追加</h2>
        <label>
          既存IDの扱い
          <select
            value={duplicateMode}
            onChange={(event) => {
              setDuplicateMode(event.target.value as ImportDuplicateMode);
              setPreview(null);
            }}
          >
            <option value="add">追加のみ: 既存IDはエラー</option>
            <option value="replace">置き換え: 既存IDを更新</option>
            <option value="skip">スキップ: 既存IDを除外</option>
          </select>
        </label>
        <div className="import-actions">
          <label className="file-button">
            <Upload aria-hidden="true" size={18} />
            CSVを選択
            <input type="file" accept=".csv,text/csv" onChange={parseFile} />
          </label>
          <button className="secondary" type="button" onClick={loadSample}>
            <DatabaseBackup aria-hidden="true" size={18} />
            架空サンプル
          </button>
        </div>
      </div>

      {preview && (
        <div className="panel">
          <div className="summary-grid">
            <StatPill label="成功" value={preview.summary.success} />
            <StatPill label="警告" value={preview.summary.warnings} />
            <StatPill label="エラー" value={preview.summary.errors} />
            <StatPill label="除外" value={preview.summary.skipped} />
          </div>
          <button className="primary full" type="button" onClick={commit} disabled={preview.questions.length === 0}>
            <Check aria-hidden="true" size={18} />
            有効行を取り込む
          </button>
          <p className="muted">現在の重複処理: {preview.duplicateMode === "add" ? "追加のみ" : preview.duplicateMode === "replace" ? "置き換え" : "スキップ"}</p>
          <IssueList issues={preview.issues} />
        </div>
      )}

      {message && <p className="success-message">{message}</p>}

      <div className="panel">
        <h2>取込履歴</h2>
        <div className="job-list">
          {importJobs.map((job) => {
            const deletableCount = job.questionIds?.length ?? 0;
            return (
              <div key={job.id} className="job-item">
                <div className="job-main">
                  <strong>{job.sourceName}</strong>
                  <span>{formatDate(job.importedAt)}</span>
                  <small>
                    成功 {job.successCount} / 警告 {job.warningCount} / エラー {job.errorCount}
                    {deletableCount > 0 ? ` / 削除対象 ${deletableCount}問` : " / 削除対象IDなし"}
                  </small>
                </div>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void deleteImport(job)}
                  disabled={deletableCount === 0 || deletingJobId === job.id}
                  title={deletableCount === 0 ? "古い取込履歴は一括削除できません" : "この取込分を削除"}
                >
                  <Trash2 aria-hidden="true" size={16} />
                  {deletingJobId === job.id ? "削除中" : "削除"}
                </button>
              </div>
            );
          })}
          {importJobs.length === 0 && <p className="muted">履歴はありません。</p>}
        </div>
      </div>
    </section>
  );
}

function IssueList({ issues }: { issues: ImportIssue[] }) {
  if (issues.length === 0) return <p className="muted">警告とエラーはありません。</p>;
  return (
    <div className="issue-list">
      {issues.map((issue, index) => (
        <div key={`${issue.row}-${issue.field}-${index}`} className={`issue ${issue.severity}`}>
          <strong>
            {issue.severity === "error" ? "エラー" : "警告"} 行{issue.row}
          </strong>
          <span>{issue.field}</span>
          <p>{issue.message}</p>
        </div>
      ))}
    </div>
  );
}

function SettingsView({
  stats,
  lastBackupAt,
  lastRestoreAt,
  onRefresh
}: {
  stats: PracticeStats;
  lastBackupAt?: string;
  lastRestoreAt?: string;
  onRefresh: () => Promise<void>;
}) {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [message, setMessage] = useState("");

  const exportBackup = async () => {
    await downloadBackup();
    setMessage("バックアップを書き出しました。");
    await onRefresh();
  };

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm("復元前に現在のデータをJSONで書き出します。その後、端末内データを選択したバックアップで置き換えます。続行しますか？")) {
      event.target.value = "";
      return;
    }
    try {
      await downloadBackup();
      const payload = await restoreBackupFromFile(file);
      setMessage(`${payload.questions.length}問を復元しました。`);
      await onRefresh();
    } catch (error) {
      setMessage(`復元できませんでした: ${(error as Error).message}`);
    } finally {
      event.target.value = "";
    }
  };

  const persist = async () => {
    const status = await requestPersistentStorage();
    setStorage(status);
  };

  return (
    <section className="view-stack">
      <div className="summary-grid">
        <StatPill label="全問題" value={stats.totalQuestions} />
        <StatPill label="出題" value={stats.activeQuestions} />
        <StatPill label="回答履歴" value={stats.attempts} />
        <StatPill label="復習期限" value={stats.dueQuestions} />
      </div>

      <div className="panel">
        <h2>iPhoneで使う</h2>
        <ol className="step-list">
          <li>HTTPSで公開されたアプリURLをiPhoneのSafariで開きます。</li>
          <li>共有ボタンをタップします。</li>
          <li>「ホーム画面に追加」を選びます。</li>
          <li>ホーム画面のICU MCQアイコンから起動します。</li>
          <li>ファイルアプリからCSVを取り込み、定期的にバックアップJSONを書き出します。</li>
        </ol>
      </div>

      <div className="panel">
        <h2>バックアップ</h2>
        <div className="settings-actions">
          <button className="primary" type="button" onClick={exportBackup}>
            <Download aria-hidden="true" size={18} />
            書き出し
          </button>
          <label className="file-button secondary-like">
            <Upload aria-hidden="true" size={18} />
            復元
            <input type="file" accept="application/json,.json" onChange={restoreBackup} />
          </label>
        </div>
        <dl className="settings-list">
          <div>
            <dt>最終バックアップ</dt>
            <dd>{formatDate(lastBackupAt)}</dd>
          </div>
          <div>
            <dt>最終復元</dt>
            <dd>{formatDate(lastRestoreAt)}</dd>
          </div>
        </dl>
      </div>

      <div className="panel">
        <h2>端末内保存</h2>
        <button className="secondary" type="button" onClick={persist}>
          <ShieldCheck aria-hidden="true" size={18} />
          永続化を確認
        </button>
        {storage && (
          <dl className="settings-list">
            <div>
              <dt>永続化</dt>
              <dd>{storage.persisted ? "有効" : "未保証"}</dd>
            </div>
            <div>
              <dt>使用量</dt>
              <dd>{storage.usage ? `${Math.round(storage.usage / 1024 / 1024)} MB` : "不明"}</dd>
            </div>
            <div>
              <dt>上限目安</dt>
              <dd>{storage.quota ? `${Math.round(storage.quota / 1024 / 1024)} MB` : "不明"}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="panel">
        <h2>利用範囲</h2>
        <p className="policy-text">
          本アプリは問題・解説の配布、共有、販売を目的としません。問題文と解説本文は端末内のみに保存します。
        </p>
      </div>

      {message && <p className="success-message">{message}</p>}
    </section>
  );
}

export default App;
