export type AnswerMode = "single" | "multiple";
export type QuestionStatus = "active" | "excluded" | "deleted" | "draft";
export type ExplanationSource = "official" | "manual" | "none";
export type SourceType = "csv" | "pdf" | "manual";
export type AttemptMode = "practice" | "review" | "exam";
export type ImportJobStatus = "draft" | "validated" | "committed" | "failed";
export type ImportDuplicateMode = "add" | "replace" | "skip";

export interface Choice {
  key: string;
  text: string;
}

export interface Question {
  id: string;
  year: number;
  number: number;
  stem: string;
  choices: Choice[];
  correctAnswers: string[];
  answerMode: AnswerMode;
  explanation?: string;
  explanationSource: ExplanationSource;
  tags: string[];
  status: QuestionStatus;
  sourceNote?: string;
  sourceType: SourceType;
  importJobId?: string;
  page?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Attempt {
  id: string;
  questionId: string;
  selectedAnswers: string[];
  isCorrect: boolean;
  answeredAt: string;
  elapsedMs?: number;
  mode: AttemptMode;
}

export interface QuestionState {
  questionId: string;
  bookmarked: boolean;
  memo?: string;
  lastAnsweredAt?: string;
  lastCorrect?: boolean;
  correctCount: number;
  wrongCount: number;
  correctStreak: number;
  reviewDueAt?: string;
}

export interface Asset {
  id: string;
  questionId: string;
  type: "image";
  blob: Blob;
  mimeType: string;
  altText?: string;
  sha256?: string;
}

export interface ImportJob {
  id: string;
  sourceName: string;
  sourceType: SourceType;
  importedAt: string;
  status: ImportJobStatus;
  schemaVersion: number;
  successCount: number;
  warningCount: number;
  errorCount: number;
  questionIds?: string[];
}

export interface AppSetting<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}

export interface ImportIssue {
  row: number;
  questionId?: string;
  severity: "error" | "warning";
  field: string;
  message: string;
}

export interface ImportSummary {
  success: number;
  warnings: number;
  errors: number;
  skipped: number;
  totalRows: number;
}

export interface ImportPreview {
  sourceName: string;
  duplicateMode: ImportDuplicateMode;
  questions: Question[];
  issues: ImportIssue[];
  summary: ImportSummary;
}

export interface BackupAsset {
  id: string;
  questionId: string;
  type: "image";
  dataUrl: string;
  mimeType: string;
  altText?: string;
  sha256?: string;
}

export interface BackupPayload {
  app: "icu-mcq-pwa";
  schemaVersion: 1;
  exportedAt: string;
  questions: Question[];
  attempts: Attempt[];
  questionStates: QuestionState[];
  assets: BackupAsset[];
  importJobs: ImportJob[];
  settings: AppSetting[];
}

export interface PracticeStats {
  totalQuestions: number;
  activeQuestions: number;
  answeredQuestions: number;
  bookmarkedQuestions: number;
  dueQuestions: number;
  attempts: number;
}
