import {
  Bookmark,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DatabaseBackup,
  Download,
  ExternalLink,
  FileUp,
  Library,
  ListChecks,
  Newspaper,
  PlayCircle,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Shuffle,
  Trash2,
  Wand2,
  Upload,
  X
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { downloadBackup, restoreBackupFromFile } from "./backup";
import { computeStats, db, getSetting, nowIso, setSetting } from "./db";
import { commitImportPreview, deleteImportJobQuestions, parseCsvToPreview } from "./importer/csv";
import { GlossaryEntry, mergeGlossaryEntries, normalizeGlossaryEntries, splitTextByGlossary } from "./glossary";
import { extractQuestionDraftsFromPdf, PdfQuestionDraft } from "./pdfImport";
import {
  EMPTY_PUBMED_CACHE,
  loadPubMedCache,
  loadRemotePubMedCache,
  PubMedCachePayload,
  PubMedDailyDigest,
  PubMedAlertKey,
  PubMedArticle,
  PUBMED_CACHE_EVENT,
  PUBMED_ALERTS
} from "./pubmed";
import { PUBMED_TRIAL_SUMMARIES } from "./pubmedTrialSummaries";
import { accuracyLabel, questionPathLabel, questionSourceDetail, sourceTypeLabel } from "./questionDisplay";
import { parseChoices, parsePastedQuestionBlock, parseStringList } from "./questionParsing";
import { recordAttempt } from "./services/attempts";
import { requestPersistentStorage, StorageStatus } from "./storage";
import { buildTagPerformance, buildWeakQuestionQueue, buildYearPerformance, CategoryPerformance } from "./studyAnalytics";
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

type TabKey = "practice" | "review" | "stats" | "manage" | "literature" | "import" | "settings";
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
  { key: "stats", label: "成績", icon: ClipboardList },
  { key: "manage", label: "管理", icon: Library },
  { key: "import", label: "取込", icon: FileUp },
  { key: "settings", label: "設定", icon: Settings }
];

const TAB_KEYS = new Set<TabKey>([...TAB_ITEMS.map((item) => item.key), "literature"]);

function tabFromLocation(): TabKey {
  if (typeof window === "undefined") return "practice";
  const fromQuery = new URLSearchParams(window.location.search).get("tab");
  const fromHash = window.location.hash.replace(/^#/, "");
  if (fromQuery && TAB_KEYS.has(fromQuery as TabKey)) return fromQuery as TabKey;
  if (fromHash && TAB_KEYS.has(fromHash as TabKey)) return fromHash as TabKey;
  return "practice";
}

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

function pubMedArticleMatches(article: PubMedArticle, normalizedQuery: string) {
  if (!normalizedQuery) return true;
  const searchableText = [
    article.title,
    article.abstract,
    article.journal,
    article.publicationDate,
    article.doi,
    article.pmid,
    article.authors.join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return searchableText.includes(normalizedQuery);
}

function uniquePubMedArticlesByPmid(articles: PubMedArticle[]) {
  const byPmid = new Map<string, PubMedArticle>();
  for (const article of articles) {
    if (!byPmid.has(article.pmid)) byPmid.set(article.pmid, article);
  }
  return [...byPmid.values()];
}

function clipText(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3))}...`;
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

function formatPercentValue(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "未回答";
  return `${Math.round(value * 100)}%`;
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

function useLongTermStudyStorage() {
  useEffect(() => {
    let cancelled = false;

    const persist = async () => {
      try {
        const lastCheckedAt = await getSetting<string | undefined>("lastPersistenceCheckAt", undefined);
        const lastCheckedTime = lastCheckedAt ? Date.parse(lastCheckedAt) : 0;
        if (Number.isFinite(lastCheckedTime) && Date.now() - lastCheckedTime < 7 * 24 * 60 * 60 * 1000) return;

        const status = await requestPersistentStorage();
        if (cancelled) return;
        await Promise.all([
          setSetting("lastPersistenceCheckAt", nowIso()),
          setSetting("storagePersisted", Boolean(status.persisted))
        ]);
      } catch {
        if (!cancelled) await setSetting("lastPersistenceCheckAt", nowIso());
      }
    };

    void persist();
    return () => {
      cancelled = true;
    };
  }, []);
}

function App() {
  useLongTermStudyStorage();

  const [activeTab, setActiveTab] = useState<TabKey>(() => tabFromLocation());
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [states, setStates] = useState<QuestionState[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [stats, setStats] = useState<PracticeStats>(EMPTY_STATS);
  const [noticeAccepted, setNoticeAccepted] = useState(true);
  const [lastBackupAt, setLastBackupAt] = useState<string | undefined>();
  const [lastRestoreAt, setLastRestoreAt] = useState<string | undefined>();
  const [customGlossaryEntries, setCustomGlossaryEntries] = useState<GlossaryEntry[]>([]);
  const statesByQuestion = useMemo(() => stateMap(states), [states]);
  const glossaryEntries = useMemo(() => mergeGlossaryEntries(customGlossaryEntries), [customGlossaryEntries]);

  const refresh = async () => {
    const [
      nextQuestions,
      nextAttempts,
      nextStates,
      nextImportJobs,
      nextStats,
      accepted,
      backupAt,
      restoreAt,
      nextCustomGlossaryEntries
    ] =
      await Promise.all([
        db.questions.orderBy("id").toArray(),
        db.attempts.orderBy("answeredAt").reverse().toArray(),
        db.questionStates.toArray(),
        db.importJobs.orderBy("importedAt").reverse().toArray(),
        computeStats(),
        getSetting("noticeAccepted", false),
        getSetting<string | undefined>("lastBackupAt", undefined),
        getSetting<string | undefined>("lastRestoreAt", undefined),
        getSetting<GlossaryEntry[]>("customGlossaryEntries", [])
      ]);
    setQuestions(nextQuestions);
    setAttempts(nextAttempts);
    setStates(nextStates);
    setImportJobs(nextImportJobs);
    setStats(nextStats);
    setNoticeAccepted(accepted);
    setLastBackupAt(backupAt);
    setLastRestoreAt(restoreAt);
    setCustomGlossaryEntries(normalizeGlossaryEntries(nextCustomGlossaryEntries));
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const syncTab = () => setActiveTab(tabFromLocation());
    window.addEventListener("popstate", syncTab);
    window.addEventListener("hashchange", syncTab);
    return () => {
      window.removeEventListener("popstate", syncTab);
      window.removeEventListener("hashchange", syncTab);
    };
  }, []);

  const selectTab = (tab: TabKey) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.hash = "";
    window.history.pushState({}, "", url);
  };

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
        <div className="header-actions">
          <button
            className={activeTab === "literature" ? "header-link active" : "header-link"}
            type="button"
            onClick={() => selectTab("literature")}
            aria-current={activeTab === "literature" ? "page" : undefined}
            title="PubMed文献アラートを開く"
          >
            <Newspaper aria-hidden="true" size={18} />
            <span>論文</span>
          </button>

          <div className="header-badges" aria-label="学習状況">
            <StatPill label="問題" value={stats.activeQuestions} />
            <StatPill label="復習" value={stats.dueQuestions} />
          </div>
        </div>
      </header>

      <main className="app-main">
        {activeTab === "practice" && (
          <PracticeView
            questions={questions}
            statesByQuestion={statesByQuestion}
            stats={stats}
            glossaryEntries={glossaryEntries}
            onRefresh={refresh}
          />
        )}
        {activeTab === "review" && (
          <ReviewView
            questions={questions}
            statesByQuestion={statesByQuestion}
            glossaryEntries={glossaryEntries}
            onRefresh={refresh}
          />
        )}
        {activeTab === "stats" && (
          <StatsView questions={questions} attempts={attempts} statesByQuestion={statesByQuestion} />
        )}
        {activeTab === "manage" && (
          <ManageView questions={questions} statesByQuestion={statesByQuestion} onRefresh={refresh} />
        )}
        {activeTab === "literature" && <LiteratureView />}
        {activeTab === "import" && <ImportView importJobs={importJobs} onRefresh={refresh} />}
        {activeTab === "settings" && (
          <SettingsView
            stats={stats}
            lastBackupAt={lastBackupAt}
            lastRestoreAt={lastRestoreAt}
            customGlossaryEntries={customGlossaryEntries}
            glossaryEntries={glossaryEntries}
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
              onClick={() => selectTab(item.key)}
              title={item.label}
              aria-current={activeTab === item.key ? "page" : undefined}
              aria-label={item.label}
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
  glossaryEntries,
  onRefresh
}: {
  questions: Question[];
  statesByQuestion: Map<string, QuestionState>;
  stats: PracticeStats;
  glossaryEntries: GlossaryEntry[];
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
        glossaryEntries={glossaryEntries}
        onRefresh={onRefresh}
      />
    </section>
  );
}

function ReviewView({
  questions,
  statesByQuestion,
  glossaryEntries,
  onRefresh
}: {
  questions: Question[];
  statesByQuestion: Map<string, QuestionState>;
  glossaryEntries: GlossaryEntry[];
  onRefresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("all");
  const [sortKey, setSortKey] = useState<StudySortKey>("due");
  const [mistakeLoop, setMistakeLoop] = useState(false);
  const [targetStreak, setTargetStreak] = useState("2");
  const activeQuestions = questions.filter((question) => question.status === "active");
  const targetStreakCount = Number(targetStreak);
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
  const mistakeLoopQuestions = activeQuestions.filter((question) => {
    const state = statesByQuestion.get(question.id);
    return Boolean((state?.wrongCount ?? 0) > 0 && (state?.correctStreak ?? 0) < targetStreakCount);
  });
  const reviewSource = mistakeLoop ? mistakeLoopQuestions : reviewQuestionsBeforeSort;
  const reviewQuestions = sortStudyQuestions(reviewSource, statesByQuestion, sortKey);

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
      <div className="loop-panel">
        <label className="check-row">
          <input
            type="checkbox"
            checked={mistakeLoop}
            onChange={(event) => {
              setMistakeLoop(event.target.checked);
              if (event.target.checked) {
                setFilter("mistake");
                setSortKey("weak");
              }
            }}
          />
          <span>誤答だけ周回する</span>
        </label>
        <label>
          クリア条件
          <select value={targetStreak} onChange={(event) => setTargetStreak(event.target.value)}>
            <option value="1">1回正解で外す</option>
            <option value="2">2回連続正解で外す</option>
            <option value="3">3回連続正解で外す</option>
          </select>
        </label>
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
          {mistakeLoop && <span>周回残り {mistakeLoopQuestions.length}問</span>}
          <span>出題中 {activeQuestions.length}問</span>
        </div>
      </div>
      <QuestionRunner
        emptyTitle={mistakeLoop ? "誤答周回は完了です" : "復習対象はありません"}
        mode="review"
        questions={reviewQuestions}
        statesByQuestion={statesByQuestion}
        glossaryEntries={glossaryEntries}
        onRefresh={onRefresh}
      />
    </section>
  );
}

function StatsView({
  questions,
  attempts,
  statesByQuestion
}: {
  questions: Question[];
  attempts: Attempt[];
  statesByQuestion: Map<string, QuestionState>;
}) {
  const activeQuestions = questions.filter((question) => question.status === "active");
  const tagRows = buildTagPerformance(questions, attempts, statesByQuestion);
  const yearRows = buildYearPerformance(questions, attempts, statesByQuestion);
  const weakQueue = buildWeakQuestionQueue(questions, statesByQuestion, 8);
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const correctAttempts = attempts.filter((attempt) => attempt.isCorrect).length;
  const overallAccuracy = attempts.length > 0 ? correctAttempts / attempts.length : null;
  const wrongQuestionCount = activeQuestions.filter((question) => (statesByQuestion.get(question.id)?.wrongCount ?? 0) > 0).length;
  const noExplanationCount = activeQuestions.filter((question) => !question.explanation?.trim()).length;
  const answeredQuestionCount = activeQuestions.filter((question) => statesByQuestion.get(question.id)?.lastAnsweredAt).length;

  return (
    <section className="view-stack">
      <div className="metric-row">
        <StatPill label="全体正答率" value={formatPercentValue(overallAccuracy)} />
        <StatPill label="回答済" value={`${answeredQuestionCount}/${activeQuestions.length}`} />
        <StatPill label="誤答あり" value={wrongQuestionCount} />
      </div>
      <div className="metric-row">
        <StatPill label="回答履歴" value={attempts.length} />
        <StatPill label="分類" value={tagRows.length} />
        <StatPill label="解説なし" value={noExplanationCount} />
      </div>

      <PerformancePanel title="タグ別正答率" rows={tagRows} emptyText="タグ付き問題がありません" />
      <PerformancePanel title="年度別正答率" rows={yearRows} emptyText="年度別に表示できる問題がありません" />

      <section className="panel performance-panel">
        <div className="section-heading-row">
          <div>
            <h2>誤答周回候補</h2>
            <p className="muted">復習タブで「誤答だけ周回」をONにすると、この順で潰せます。</p>
          </div>
          <span className="performance-badge">{weakQueue.length}問</span>
        </div>
        {weakQueue.length === 0 ? (
          <p className="muted">誤答記録のある問題はまだありません。</p>
        ) : (
          <div className="weak-list">
            {weakQueue.map((item) => {
              const question = questionsById.get(item.questionId);
              if (!question) return null;
              return (
                <div className="weak-item" key={item.questionId}>
                  <div>
                    <strong>{questionPathLabel(question)}</strong>
                    <span>{clipText(question.stem, 76)}</span>
                  </div>
                  <small>
                    誤答{item.wrongCount} / 正解{item.correctCount} / 連続{item.correctStreak}
                  </small>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function PerformancePanel({
  title,
  rows,
  emptyText
}: {
  title: string;
  rows: CategoryPerformance[];
  emptyText: string;
}) {
  const maxWrong = Math.max(1, ...rows.map((row) => row.wrongAttemptCount));
  return (
    <section className="panel performance-panel">
      <div className="section-heading-row">
        <h2>{title}</h2>
        <span className="performance-badge">{rows.length}分類</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="performance-list">
          {rows.map((row) => {
            const accuracy = row.accuracy ?? 0;
            const wrongWidth = Math.max(6, Math.round((row.wrongAttemptCount / maxWrong) * 100));
            return (
              <article className="performance-row" key={row.key}>
                <div className="performance-main">
                  <div className="performance-title">
                    <strong>{row.label}</strong>
                    <span>{formatPercentValue(row.accuracy)}</span>
                  </div>
                  <div className="performance-bars" aria-hidden="true">
                    <span className="accuracy-bar" style={{ width: `${Math.round(accuracy * 100)}%` }} />
                    {row.wrongAttemptCount > 0 && <span className="wrong-bar" style={{ width: `${wrongWidth}%` }} />}
                  </div>
                </div>
                <div className="performance-meta">
                  <span>{row.questionCount}問</span>
                  <span>履歴{row.attemptCount}</span>
                  <span>誤答{row.wrongAttemptCount}</span>
                  <span>未答{row.unansweredQuestionCount}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ExplanationText({
  text,
  glossaryEntries = [],
  onGlossarySelect
}: {
  text?: string;
  glossaryEntries?: GlossaryEntry[];
  onGlossarySelect?: (entry: GlossaryEntry) => void;
}) {
  const trimmed = text?.trim();
  if (!trimmed) return <p className="explanation-text muted">解説未登録</p>;
  const lines = trimmed.split(/\r?\n/);
  return (
    <div className="explanation-rich">
      {lines.map((line, index) => {
        const value = line.trim();
        if (!value) return <span className="explanation-gap" key={`gap-${index}`} />;
        const headingMatch = value.match(/^(結論|根拠|理由|誤選択肢|選択肢|覚え方|ポイント|メモ|補足|鑑別|出典)[:：]\s*(.*)$/);
        if (headingMatch) {
          return (
            <p className="explanation-line highlighted" key={`${value}-${index}`}>
              <strong>{headingMatch[1]}</strong>
              {headingMatch[2] && (
                <span>
                  <GlossaryInlineText
                    text={headingMatch[2]}
                    entries={glossaryEntries}
                    onSelect={onGlossarySelect}
                  />
                </span>
              )}
            </p>
          );
        }
        if (/^[-*・]/.test(value)) {
          return (
            <p className="explanation-line bullet" key={`${value}-${index}`}>
              <GlossaryInlineText
                text={value.replace(/^[-*・]\s*/, "")}
                entries={glossaryEntries}
                onSelect={onGlossarySelect}
              />
            </p>
          );
        }
        return (
          <p className="explanation-line" key={`${value}-${index}`}>
            <GlossaryInlineText text={value} entries={glossaryEntries} onSelect={onGlossarySelect} />
          </p>
        );
      })}
    </div>
  );
}

function GlossaryInlineText({
  text,
  entries,
  onSelect
}: {
  text: string;
  entries: GlossaryEntry[];
  onSelect?: (entry: GlossaryEntry) => void;
}) {
  if (!onSelect || entries.length === 0) return <>{text}</>;
  return (
    <>
      {splitTextByGlossary(text, entries).map((segment, index) => {
        const entry = segment.entry;
        return entry ? (
          <button
            className="keyword-term"
            key={`${segment.text}-${entry.id}-${index}`}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(entry);
            }}
          >
            {segment.text}
          </button>
        ) : (
          <span key={`${segment.text}-${index}`}>{segment.text}</span>
        );
      })}
    </>
  );
}

function GlossarySheet({ entry, onClose }: { entry: GlossaryEntry | null; onClose: () => void }) {
  if (!entry) return null;
  return (
    <div className="glossary-overlay" role="presentation" onClick={onClose}>
      <section
        className="glossary-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="glossary-head">
          <div>
            <span>{entry.category}</span>
            <h2 id="glossary-title">{entry.term}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {entry.aliases.length > 0 && (
          <div className="tag-row">
            {entry.aliases.map((alias) => (
              <span key={alias}>{alias}</span>
            ))}
          </div>
        )}
        <p className="glossary-summary">{entry.summary}</p>
        {entry.bullets.length > 0 && (
          <ul className="glossary-bullets">
            {entry.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        )}
        <p className="muted">
          {entry.sourceNote || "自作用語メモです。必要に応じて原典で確認してください。"}
        </p>
      </section>
    </div>
  );
}

function QuestionRunner({
  questions,
  statesByQuestion,
  glossaryEntries,
  mode,
  emptyTitle,
  onRefresh
}: {
  questions: Question[];
  statesByQuestion: Map<string, QuestionState>;
  glossaryEntries: GlossaryEntry[];
  mode: AttemptMode;
  emptyTitle: string;
  onRefresh: () => Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<Attempt | null>(null);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeGlossaryEntry, setActiveGlossaryEntry] = useState<GlossaryEntry | null>(null);
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
      setActiveGlossaryEntry(null);
      setQuestionStartedAt(Date.now());
    }, [questionSetKey, mode]);

  useEffect(() => {
    setSelectedAnswers([]);
    setResult(null);
    setAnswerRevealed(false);
    setSubmitting(false);
    setActiveGlossaryEntry(null);
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
    if (answerVisible) void onRefresh();
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
    if (answerVisible) void onRefresh();
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
        <p className="stem">
          <GlossaryInlineText
            text={question.stem}
            entries={glossaryEntries}
            onSelect={setActiveGlossaryEntry}
          />
        </p>
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
              <span>
                <GlossaryInlineText
                  text={choice.text}
                  entries={glossaryEntries}
                  onSelect={setActiveGlossaryEntry}
                />
              </span>
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
                  <span>
                    <GlossaryInlineText
                      text={choice.text}
                      entries={glossaryEntries}
                      onSelect={setActiveGlossaryEntry}
                    />
                  </span>
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
                  <span>
                    <GlossaryInlineText
                      text={choice.text}
                      entries={glossaryEntries}
                      onSelect={setActiveGlossaryEntry}
                    />
                  </span>
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
            <ExplanationText
              text={question.explanation}
              glossaryEntries={glossaryEntries}
              onGlossarySelect={setActiveGlossaryEntry}
            />
            {!question.explanation?.trim() && (
              <p className="muted">管理タブで「結論・根拠・誤選択肢・覚え方」を追記できます。</p>
            )}
          </div>
          {questionState?.memo?.trim() && (
            <div className="explanation-block">
              <div className="section-label">自分の補足メモ</div>
              <ExplanationText
                text={questionState.memo}
                glossaryEntries={glossaryEntries}
                onGlossarySelect={setActiveGlossaryEntry}
              />
            </div>
          )}
          <button className="primary full" type="button" onClick={nextQuestion}>
            <PlayCircle aria-hidden="true" size={18} />
            次の問題へ
          </button>
        </section>
      )}

      <MemoBox initialValue={questionState?.memo ?? ""} onSave={saveMemo} />
      <GlossarySheet entry={activeGlossaryEntry} onClose={() => setActiveGlossaryEntry(null)} />
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

  const appendExplanationTemplate = () => {
    const template = [
      "結論:",
      "",
      "根拠:",
      "",
      "誤選択肢:",
      "- A:",
      "- B:",
      "- C:",
      "- D:",
      "",
      "覚え方:",
      "",
      "出典:"
    ].join("\n");
    setDraft((current) => ({
      ...current,
      explanation: current.explanation?.trim() ? `${current.explanation.trim()}\n\n${template}` : template
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
      <div className="editor-helpers">
        <button className="secondary" type="button" onClick={appendExplanationTemplate}>
          <Wand2 aria-hidden="true" size={17} />
          解説テンプレを追記
        </button>
        <div className="filter-summary inline-summary">
          <strong>結論・根拠・誤選択肢・覚え方</strong>
          <span>自分用に整形</span>
        </div>
      </div>
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

function LiteratureView() {
  const [activeAlertKey, setActiveAlertKey] = useState<PubMedAlertKey>("focused");
  const [pubMedCache, setPubMedCache] = useState<PubMedCachePayload>(() => loadPubMedCache());
  const [message, setMessage] = useState("");
  const [literatureQuery, setLiteratureQuery] = useState("");
  const [onlyWithAbstract, setOnlyWithAbstract] = useState(false);
  const [showAllImportant, setShowAllImportant] = useState(false);

  const activeAlert = PUBMED_ALERTS.find((alert) => alert.key === activeAlertKey) ?? PUBMED_ALERTS[0];
  const articles = pubMedCache.articlesByAlert[activeAlertKey] ?? EMPTY_PUBMED_CACHE.articlesByAlert[activeAlertKey];
  const summary = pubMedCache.summaryByAlert[activeAlertKey];
  const fetchedAt = pubMedCache.fetchedAtByAlert[activeAlertKey];
  const importantArticles = pubMedCache.importantArticles ?? [];
  const articleSummariesByPmid = pubMedCache.articleSummariesByPmid ?? {};
  const normalizedLiteratureQuery = literatureQuery.trim().toLowerCase();
  const filteredArticles = articles.filter(
    (article) => pubMedArticleMatches(article, normalizedLiteratureQuery) && (!onlyWithAbstract || Boolean(article.abstract.trim()))
  );
  const filteredImportantArticles = importantArticles.filter(
    (article) => pubMedArticleMatches(article, normalizedLiteratureQuery) && (!onlyWithAbstract || Boolean(article.abstract.trim()))
  );
  const filteredTrialSummaries = PUBMED_TRIAL_SUMMARIES.filter((item) => {
    if (!normalizedLiteratureQuery) return true;
    return [item.title, item.summary, item.whyItMatters, item.caveat, item.journal, item.pmid, item.tags.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(normalizedLiteratureQuery);
  });
  const fallbackDigestArticles = uniquePubMedArticlesByPmid([
    ...(pubMedCache.articlesByAlert.focused ?? []),
    ...(pubMedCache.articlesByAlert.broad ?? [])
  ]);
  const fallbackDigestGeneratedAt =
    pubMedCache.lastAutoRunAt || pubMedCache.importantFetchedAt || fetchedAt || pubMedCache.lastImportantRunAt;
  const fallbackDailyDigest: PubMedDailyDigest | undefined =
    pubMedCache.dailyDigests && pubMedCache.dailyDigests.length > 0
      ? undefined
      : fallbackDigestArticles.length > 0 || importantArticles.length > 0 || summary || pubMedCache.importantSummary
        ? {
            date: pubMedCache.lastAutoRunDate || fallbackDigestGeneratedAt?.slice(0, 10) || "latest",
            generatedAt: fallbackDigestGeneratedAt || new Date(0).toISOString(),
            summary: pubMedCache.importantSummary || summary,
            articles: fallbackDigestArticles,
            importantArticles,
            articleSummaries: articleSummariesByPmid
          }
        : undefined;
  const dailyDigests =
    pubMedCache.dailyDigests && pubMedCache.dailyDigests.length > 0
      ? pubMedCache.dailyDigests
      : fallbackDailyDigest
        ? [fallbackDailyDigest]
        : [];
  const filteredDailyDigests = dailyDigests
    .map((digest) => ({
      ...digest,
      articles: digest.articles.filter(
        (article) => pubMedArticleMatches(article, normalizedLiteratureQuery) && (!onlyWithAbstract || Boolean(article.abstract.trim()))
      ),
      importantArticles: digest.importantArticles.filter(
        (article) => pubMedArticleMatches(article, normalizedLiteratureQuery) && (!onlyWithAbstract || Boolean(article.abstract.trim()))
      )
    }))
    .filter(
      (digest) =>
        !normalizedLiteratureQuery ||
        digest.summary?.toLowerCase().includes(normalizedLiteratureQuery) ||
        Object.values(digest.articleSummaries ?? {}).some((item) =>
          item.summary.toLowerCase().includes(normalizedLiteratureQuery)
        ) ||
        digest.articles.length > 0 ||
        digest.importantArticles.length > 0
    );
  const latestDailyDigest = filteredDailyDigests[0] ?? dailyDigests[0];
  const visibleImportantArticles = showAllImportant ? filteredImportantArticles : filteredImportantArticles.slice(0, 10);
  const topImportantArticles =
    latestDailyDigest?.importantArticles && latestDailyDigest.importantArticles.length > 0
      ? latestDailyDigest.importantArticles.slice(0, 6)
      : latestDailyDigest?.articles && latestDailyDigest.articles.length > 0
        ? latestDailyDigest.articles.slice(0, 6)
      : filteredImportantArticles.slice(0, 6);
  const topTrialSummaries = filteredTrialSummaries.slice(0, 6);
  const publishedSummary = (latestDailyDigest?.summary || pubMedCache.importantSummary || summary || "").trim();
  const latestPublishedAt =
    latestDailyDigest?.generatedAt || pubMedCache.importantFetchedAt || fetchedAt || pubMedCache.lastImportantRunAt || pubMedCache.lastAutoRunAt;

  useEffect(() => {
    let isMounted = true;
    const syncCache = () => setPubMedCache(loadPubMedCache());
    window.addEventListener(PUBMED_CACHE_EVENT, syncCache);
    loadRemotePubMedCache()
      .then((remoteCache) => {
        if (isMounted && remoteCache) setPubMedCache(remoteCache);
      })
      .catch(() => {
        // Keep the bundled fallback cache when GitHub raw data is unavailable.
      });
    return () => {
      isMounted = false;
      window.removeEventListener(PUBMED_CACHE_EVENT, syncCache);
    };
  }, []);

  const copyLiteratureLink = async () => {
    const literatureUrl = `${window.location.origin}${window.location.pathname}?tab=literature`;
    try {
      await navigator.clipboard.writeText(literatureUrl);
      setMessage("文献タブの直接リンクをコピーしました。iPhoneではSafariで開いてホーム画面に追加できます。");
    } catch {
      setMessage(`文献タブのURL: ${literatureUrl}`);
    }
  };

  return (
    <section className="view-stack">
      <div className="panel pubmed-hero">
        <div>
          <p className="eyebrow">PubMed Alert</p>
          <h2>毎朝の小児集中治療・循環器文献ダイジェスト</h2>
          <p className="muted">GitHub Actionsが毎朝7:00に新着候補を取得し、日ごとに整理してサイトへ反映します。</p>
        </div>
        <div className="summary-grid">
          <StatPill label="検索式" value="2種類" />
          <StatPill label="自動更新" value="7:00" />
          <StatPill label="日別履歴" value={dailyDigests.length} />
          <StatPill label="最新更新" value={latestPublishedAt ? formatShortDate(latestPublishedAt) : "待機中"} />
        </div>
      </div>

      <div className="literature-dashboard" aria-label="論文まとめダッシュボード">
        <section className="literature-brief-panel">
          <div className="literature-panel-head">
            <div>
              <p className="eyebrow">Digest</p>
              <h2>先に読む論文まとめ</h2>
            </div>
            <span className="literature-update-pill">
              {latestPublishedAt ? formatShortDate(latestPublishedAt) : "自動生成待ち"}
            </span>
          </div>
          {publishedSummary ? (
            <div className="literature-brief-text">{publishedSummary}</div>
          ) : (
            <div className="literature-empty-brief">
              <strong>日別ダイジェストは次回の自動更新で作成されます。</strong>
              <span>手動取得や画面上のAPIキー入力は使わず、GitHub Actionsで新着論文を取得してこのページに反映します。</span>
            </div>
          )}
          <div className="literature-digest-stats">
            <StatPill label="AI要約" value={publishedSummary ? "あり" : "待機中"} />
            <StatPill label="重要候補" value={latestDailyDigest?.importantArticles.length ?? filteredImportantArticles.length} />
            <StatPill label="新着候補" value={latestDailyDigest?.articles.length ?? filteredArticles.length} />
            <StatPill label="履歴" value={`${dailyDigests.length}日`} />
          </div>
        </section>

        <section className="literature-top-panel">
          <div className="literature-panel-head">
            <div>
              <p className="eyebrow">Reading Queue</p>
              <h2>読む順リスト</h2>
            </div>
            <a className="literature-mini-link" href="#pubmed-important">
              候補へ
            </a>
          </div>
          <div className="literature-rank-list">
            {topImportantArticles.length > 0
              ? topImportantArticles.map((article, index) => {
                  const aiSummary = articleSummariesByPmid[article.pmid]?.summary;
                  return (
                    <article key={`rank-${article.pmid}`} className="literature-rank-card">
                      <span className="rank-index">{index + 1}</span>
                      <div>
                        <h3>{article.title}</h3>
                        <p className={aiSummary ? "literature-ai-note" : undefined}>
                          {clipText(aiSummary || article.abstract || "抄録はありません。PubMedで詳細を確認してください。", aiSummary ? 260 : 130)}
                        </p>
                        <div className="tag-row">
                          <span>PMID {article.pmid}</span>
                          {aiSummary && <span>AI要約済み</span>}
                          {article.journal && <span>{article.journal}</span>}
                          {article.publicationDate && <span>{article.publicationDate}</span>}
                        </div>
                      </div>
                      <a href={article.url} target="_blank" rel="noreferrer" title="PubMedで開く">
                        <ExternalLink aria-hidden="true" size={17} />
                      </a>
                    </article>
                  );
                })
              : topTrialSummaries.map((item, index) => (
                  <article key={`rank-trial-${item.pmid}`} className="literature-rank-card">
                    <span className="rank-index">{index + 1}</span>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{clipText(item.summary, 150)}</p>
                      <div className="tag-row">
                        <span>PMID {item.pmid}</span>
                        <span>{item.journal}</span>
                        <span>{item.published}</span>
                      </div>
                    </div>
                    <a href={item.url} target="_blank" rel="noreferrer" title="PubMedで開く">
                      <ExternalLink aria-hidden="true" size={17} />
                    </a>
                  </article>
                ))}
          </div>
        </section>
      </div>

      {filteredDailyDigests.length > 0 && (
        <div className="daily-digest-list" id="pubmed-daily">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Daily Digest</p>
              <h2>日ごとの新着論文まとめ</h2>
              <p className="muted">毎朝の自動更新で取得した論文を、日付ごとに保存して並べます。</p>
            </div>
            <span className="result-count">{filteredDailyDigests.length}/{dailyDigests.length}日</span>
          </div>
          {filteredDailyDigests.map((digest) => {
            const digestPapers = uniquePubMedArticlesByPmid([...digest.importantArticles, ...digest.articles]).slice(0, 8);
            return (
              <section className="panel daily-digest-card" key={digest.date}>
                <div className="daily-digest-head">
                  <div>
                    <p className="eyebrow">{digest.date}</p>
                    <h3>{digest.date === latestDailyDigest?.date ? "最新の自動まとめ" : "過去の自動まとめ"}</h3>
                  </div>
                  <span className="literature-update-pill">{formatShortDate(digest.generatedAt)}</span>
                </div>
                {digest.summary ? (
                  <div className="ai-summary-text daily-summary-text">{digest.summary}</div>
                ) : (
                  <p className="muted">この日のAI要約はまだありません。論文リンクからPubMedで確認できます。</p>
                )}
                {digestPapers.length > 0 && (
                  <div className="daily-paper-list">
                    {digestPapers.map((article) => {
                      const aiSummary =
                        digest.articleSummaries?.[article.pmid]?.summary || articleSummariesByPmid[article.pmid]?.summary;
                      return (
                        <article className="daily-paper-item" key={`${digest.date}-${article.pmid}`}>
                          <div>
                            <h4>{article.title}</h4>
                            <div className="tag-row">
                              <span>PMID {article.pmid}</span>
                              {aiSummary && <span>AI要約済み</span>}
                              {article.journal && <span>{article.journal}</span>}
                              {article.publicationDate && <span>{article.publicationDate}</span>}
                            </div>
                            {aiSummary && <p className="daily-paper-ai-note">{aiSummary}</p>}
                          </div>
                          <a href={article.url} target="_blank" rel="noreferrer" title="PubMedで開く">
                            <ExternalLink aria-hidden="true" size={17} />
                          </a>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="alert-tabs" role="tablist" aria-label="PubMedアラート">
        {PUBMED_ALERTS.map((alert) => (
          <button
            key={alert.key}
            className={activeAlertKey === alert.key ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeAlertKey === alert.key}
            aria-controls="pubmed-selected-alert"
            onClick={() => {
              setActiveAlertKey(alert.key);
              setMessage("");
              setShowAllImportant(false);
            }}
          >
            <strong>{alert.title}</strong>
            <span>{alert.subtitle}</span>
          </button>
        ))}
      </div>

      <div className="panel pubmed-utility-panel" aria-label="文献操作">
        <div className="pubmed-utility-main">
          <label className="pubmed-search-field">
            <Search aria-hidden="true" size={18} />
            <input
              type="search"
              value={literatureQuery}
              onChange={(event) => setLiteratureQuery(event.target.value)}
              placeholder="タイトル・抄録・PMID・著者で絞り込み"
              aria-label="文献を絞り込み"
            />
          </label>
          <div className="utility-buttons">
            <button className="secondary" type="button" onClick={() => void copyLiteratureLink()}>
              <ClipboardList aria-hidden="true" size={18} />
              リンクコピー
            </button>
          </div>
        </div>
        <div className="literature-filter-row">
          <label className="check-row compact-check">
            <input
              type="checkbox"
              checked={onlyWithAbstract}
              onChange={(event) => setOnlyWithAbstract(event.target.checked)}
            />
            <span>抄録ありだけ表示</span>
          </label>
          {(literatureQuery || onlyWithAbstract) && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setLiteratureQuery("");
                setOnlyWithAbstract(false);
              }}
            >
              <RotateCcw aria-hidden="true" size={16} />
              絞り込み解除
            </button>
          )}
          <span className="muted">
            日別 {filteredDailyDigests.length}/{dailyDigests.length}、新着 {filteredArticles.length}/{articles.length}、重要候補 {filteredImportantArticles.length}/{importantArticles.length}
          </span>
        </div>
        <div className="quick-jump-row" aria-label="文献セクション">
          <a href="#pubmed-daily">日別まとめ</a>
          <a href="#pubmed-selected-alert">選択中アラート</a>
          <a href="#pubmed-important">重要候補</a>
          <a href="#pubmed-results">新着文献</a>
        </div>
      </div>

      <div className="panel pubmed-controls" id="pubmed-selected-alert">
        <div>
          <h2>{activeAlert.title}</h2>
          <p className="muted">{activeAlert.subtitle}</p>
        </div>
        <div className="summary-grid">
          <StatPill label="自動取得" value={fetchedAt ? formatShortDate(fetchedAt) : "待機中"} />
          <StatPill label="表示中" value={`${filteredArticles.length}/${articles.length}`} />
          <StatPill label="要約" value={summary ? "あり" : "日別に統合"} />
          <StatPill label="手動操作" value="なし" />
        </div>
        <details className="query-details">
          <summary>検索式を表示</summary>
          <pre className="query-box">{activeAlert.query}</pre>
        </details>
      </div>

      <div className="panel pubmed-controls important-panel" id="pubmed-important">
        <div>
          <p className="eyebrow">Recent Important Papers</p>
          <h2>重要論文まとめ</h2>
          <p className="muted">
            直近1-2年の候補から、PICU/CICUで読む価値が高いものを毎朝の自動更新で整理します。
          </p>
        </div>
        <div className="summary-grid">
          <StatPill label="候補" value={importantArticles.length} />
          <StatPill label="対象期間" value="1-2年" />
          <StatPill label="上限" value="5件/日" />
          <StatPill
            label="更新"
            value={pubMedCache.importantFetchedAt ? formatShortDate(pubMedCache.importantFetchedAt) : "未取得"}
          />
        </div>
        {pubMedCache.lastImportantRunStatus && <p className="muted">{pubMedCache.lastImportantRunStatus}</p>}
      </div>

      {dailyDigests.length === 0 && (
        <div className="panel trial-summary-panel" id="pubmed-trial">
          <div>
            <p className="eyebrow">Trial Summaries</p>
            <h2>試し読み要約</h2>
            <p className="muted">初回の自動更新までの表示サンプルです。実データが生成されると日別まとめが優先表示されます。</p>
          </div>
          <div className="trial-summary-grid">
            {filteredTrialSummaries.map((item) => (
              <article key={item.pmid} className="trial-summary-card">
                <div className="pubmed-card-head">
                  <h3>{item.title}</h3>
                  <a href={item.url} target="_blank" rel="noreferrer" title="PubMedで開く">
                    <ExternalLink aria-hidden="true" size={17} />
                  </a>
                </div>
                <div className="tag-row">
                  <span>PMID {item.pmid}</span>
                  <span>{item.journal}</span>
                  <span>{item.published}</span>
                  {item.tags.map((tag) => (
                    <span key={`${item.pmid}-${tag}`}>{tag}</span>
                  ))}
                </div>
                <p>{item.summary}</p>
                <dl className="summary-note-list">
                  <div>
                    <dt>読む理由</dt>
                    <dd>{item.whyItMatters}</dd>
                  </div>
                  <div>
                    <dt>注意点</dt>
                    <dd>{item.caveat}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          {filteredTrialSummaries.length === 0 && (
            <p className="muted">この絞り込みに一致する試し読み要約はありません。</p>
          )}
        </div>
      )}

      {message && <p className="success-message">{message}</p>}

      {importantArticles.length > 0 && (
        <div className="pubmed-list" id="pubmed-important-list">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Important Candidates</p>
              <h2>重要候補</h2>
              <p className="muted">直近1-2年以内の候補から、検索語で絞り込めます。</p>
            </div>
            <div className="list-actions">
              <span className="result-count">{filteredImportantArticles.length}/{importantArticles.length}件</span>
              {filteredImportantArticles.length > 10 && (
                <button className="secondary" type="button" onClick={() => setShowAllImportant((current) => !current)}>
                  {showAllImportant ? "10件だけ表示" : "すべて表示"}
                </button>
              )}
            </div>
          </div>
          {visibleImportantArticles.map((article) => (
            <article key={`important-${article.pmid}`} className="pubmed-card important-card">
              <div className="pubmed-card-head">
                <h3>{article.title}</h3>
                <a href={article.url} target="_blank" rel="noreferrer" title="PubMedで開く">
                  <ExternalLink aria-hidden="true" size={17} />
                </a>
              </div>
              <div className="tag-row">
                <span>重要候補</span>
                <span>PMID {article.pmid}</span>
                {article.journal && <span>{article.journal}</span>}
                {article.publicationDate && <span>{article.publicationDate}</span>}
              </div>
              {article.authors.length > 0 && <p className="muted">{article.authors.join(", ")}</p>}
              <p className="abstract-text">{article.abstract || "抄録はPubMed XML内にありません。"}</p>
            </article>
          ))}
          {filteredImportantArticles.length === 0 && <p className="muted">この絞り込みに一致する重要候補はありません。</p>}
        </div>
      )}

      <div className="pubmed-list" id="pubmed-results">
        {articles.length > 0 && (
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Selected Alert Results</p>
              <h2>新着文献</h2>
            </div>
            <span className="result-count">{filteredArticles.length}/{articles.length}件</span>
          </div>
        )}
        {filteredArticles.map((article) => (
          <article key={article.pmid} className="pubmed-card">
            <div className="pubmed-card-head">
              <h3>{article.title}</h3>
              <a href={article.url} target="_blank" rel="noreferrer" title="PubMedで開く">
                <ExternalLink aria-hidden="true" size={17} />
              </a>
            </div>
            <div className="tag-row">
              <span>PMID {article.pmid}</span>
              {article.journal && <span>{article.journal}</span>}
              {article.publicationDate && <span>{article.publicationDate}</span>}
              {article.doi && <span>doi {article.doi}</span>}
            </div>
            {article.authors.length > 0 && <p className="muted">{article.authors.join(", ")}</p>}
            <p className="abstract-text">{article.abstract || "抄録はPubMed XML内にありません。"}</p>
          </article>
        ))}
        {articles.length > 0 && filteredArticles.length === 0 && (
          <p className="muted">この絞り込みに一致する新着文献はありません。</p>
        )}
      </div>

      {articles.length === 0 && (
        <EmptyState title="PubMed文献は未取得です">
          <p>毎朝7:00の自動更新後に、日別まとめと新着文献がここへ表示されます。</p>
        </EmptyState>
      )}
    </section>
  );
}

function GlossaryManager({
  customEntries,
  glossaryEntries,
  onRefresh
}: {
  customEntries: GlossaryEntry[];
  glossaryEntries: GlossaryEntry[];
  onRefresh: () => Promise<void>;
}) {
  const emptyDraft = {
    id: "",
    term: "",
    aliasesText: "",
    category: "疾患" as GlossaryEntry["category"],
    summary: "",
    bulletsText: "",
    sourceNote: ""
  };
  const [draft, setDraft] = useState(emptyDraft);
  const [message, setMessage] = useState("");
  const builtInCount = glossaryEntries.filter((entry) => entry.builtIn).length;
  const updateDraft = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const resetDraft = () => {
    setDraft(emptyDraft);
    setMessage("");
  };

  const saveGlossaryEntry = async (event: FormEvent) => {
    event.preventDefault();
    const term = draft.term.trim();
    const summary = draft.summary.trim();
    if (!term || !summary) {
      setMessage("用語名と説明は必須です。");
      return;
    }

    const nextEntry: GlossaryEntry = {
      id: draft.id || `glossary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      term,
      aliases: parseStringList(draft.aliasesText),
      category: draft.category,
      summary,
      bullets: draft.bulletsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      sourceNote: draft.sourceNote.trim() || "自作用語メモ",
      builtIn: false,
      updatedAt: nowIso()
    };
    const nextEntries = normalizeGlossaryEntries([
      ...customEntries.filter((entry) => entry.id !== nextEntry.id),
      nextEntry
    ]);
    await setSetting("customGlossaryEntries", nextEntries);
    setMessage("用語を保存しました。");
    resetDraft();
    await onRefresh();
  };

  const editGlossaryEntry = (entry: GlossaryEntry) => {
    setDraft({
      id: entry.id,
      term: entry.term,
      aliasesText: entry.aliases.join(","),
      category: entry.category,
      summary: entry.summary,
      bulletsText: entry.bullets.join("\n"),
      sourceNote: entry.sourceNote ?? ""
    });
    setMessage("");
  };

  const deleteGlossaryEntry = async (id: string) => {
    const target = customEntries.find((entry) => entry.id === id);
    if (!target || !confirm(`「${target.term}」を用語集から削除しますか？`)) return;
    await setSetting(
      "customGlossaryEntries",
      normalizeGlossaryEntries(customEntries.filter((entry) => entry.id !== id))
    );
    if (draft.id === id) resetDraft();
    setMessage("用語を削除しました。");
    await onRefresh();
  };

  return (
    <section className="panel glossary-manager">
      <div className="section-heading-row">
        <div>
          <h2>クリック用語集</h2>
          <p className="muted">
            問題文・選択肢・解説に登録語が出ると、タップしてミニ解説を開けます。外部AIには送信しません。
          </p>
        </div>
        <span className="performance-badge">
          初期{builtInCount} / 自作{customEntries.length}
        </span>
      </div>

      <form className="glossary-form" onSubmit={saveGlossaryEntry}>
        <div className="form-row">
          <label>
            用語名
            <input
              value={draft.term}
              onChange={(event) => updateDraft("term", event.target.value)}
              placeholder="例: MODS"
            />
          </label>
          <label>
            分類
            <select value={draft.category} onChange={(event) => updateDraft("category", event.target.value)}>
              {(["疾患", "スコア", "治療", "検査", "概念", "その他"] as const).map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          別名・略語
          <input
            value={draft.aliasesText}
            onChange={(event) => updateDraft("aliasesText", event.target.value)}
            placeholder="カンマ区切り。例: 多臓器機能障害症候群"
          />
        </label>
        <label>
          説明
          <textarea
            value={draft.summary}
            onChange={(event) => updateDraft("summary", event.target.value)}
            rows={3}
            placeholder="自分が復習時に読みたい短い説明"
          />
        </label>
        <label>
          覚えるポイント
          <textarea
            value={draft.bulletsText}
            onChange={(event) => updateDraft("bulletsText", event.target.value)}
            rows={3}
            placeholder="1行に1ポイント"
          />
        </label>
        <label>
          出典メモ
          <input
            value={draft.sourceNote}
            onChange={(event) => updateDraft("sourceNote", event.target.value)}
            placeholder="例: 自分のノート、教科書章名"
          />
        </label>
        <div className="editor-helpers">
          <button className="primary" type="submit">
            <Plus aria-hidden="true" size={17} />
            {draft.id ? "用語を更新" : "用語を追加"}
          </button>
          {draft.id && (
            <button className="secondary" type="button" onClick={resetDraft}>
              新規入力へ戻る
            </button>
          )}
          <span className="muted">初期用語はアプリ内メモです。必要に応じて自分の表現に追加してください。</span>
        </div>
      </form>

      <div className="glossary-list">
        {customEntries.length === 0 ? (
          <p className="muted">自作用語はまだありません。初期用語だけでハイライトします。</p>
        ) : (
          customEntries.map((entry) => (
            <article className="glossary-list-item" key={entry.id}>
              <div>
                <strong>{entry.term}</strong>
                <span>{entry.category}</span>
                <p>{clipText(entry.summary, 90)}</p>
              </div>
              <div className="list-actions">
                <button className="secondary" type="button" onClick={() => editGlossaryEntry(entry)}>
                  <BookOpen aria-hidden="true" size={16} />
                  編集
                </button>
                <button className="danger" type="button" onClick={() => deleteGlossaryEntry(entry.id)}>
                  <Trash2 aria-hidden="true" size={16} />
                  削除
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function SettingsView({
  stats,
  lastBackupAt,
  lastRestoreAt,
  customGlossaryEntries,
  glossaryEntries,
  onRefresh
}: {
  stats: PracticeStats;
  lastBackupAt?: string;
  lastRestoreAt?: string;
  customGlossaryEntries: GlossaryEntry[];
  glossaryEntries: GlossaryEntry[];
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

      <GlossaryManager
        customEntries={customGlossaryEntries}
        glossaryEntries={glossaryEntries}
        onRefresh={onRefresh}
      />

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


