import {
  AnswerMode,
  ExplanationSource,
  Question,
  QuestionStatus,
  SourceType
} from "./types";

export interface ValidationIssue {
  severity: "error" | "warning";
  field: string;
  message: string;
}

export const VALID_ANSWER_MODES: AnswerMode[] = ["single", "multiple"];
export const VALID_STATUSES: QuestionStatus[] = ["active", "excluded", "deleted", "draft"];
export const VALID_EXPLANATION_SOURCES: ExplanationSource[] = ["official", "manual", "none"];
export const VALID_SOURCE_TYPES: SourceType[] = ["csv", "pdf", "manual"];

export function validateQuestion(
  question: Question,
  options: { warnOnMissingExplanation?: boolean; warnOnMissingTags?: boolean; warnOnAssetReferences?: boolean } = {}
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!question.id.trim()) {
    issues.push({ severity: "error", field: "question_id", message: "question_idは必須です。" });
  }
  if (!Number.isInteger(question.year)) {
    issues.push({ severity: "error", field: "year", message: "yearは整数で入力してください。" });
  }
  if (!Number.isInteger(question.number)) {
    issues.push({ severity: "error", field: "number", message: "numberは整数で入力してください。" });
  }
  if (!question.stem.trim()) {
    issues.push({ severity: "error", field: "stem", message: "問題文が空です。" });
  }
  if (!VALID_ANSWER_MODES.includes(question.answerMode)) {
    issues.push({ severity: "error", field: "answer_mode", message: "singleまたはmultipleを指定してください。" });
  }
  if (!VALID_STATUSES.includes(question.status)) {
    issues.push({
      severity: "error",
      field: "status",
      message: "active/excluded/deleted/draftのいずれかを指定してください。"
    });
  }
  if (!VALID_EXPLANATION_SOURCES.includes(question.explanationSource)) {
    issues.push({
      severity: "error",
      field: "explanation_source",
      message: "official/manual/noneのいずれかを指定してください。"
    });
  }
  if (!VALID_SOURCE_TYPES.includes(question.sourceType)) {
    issues.push({ severity: "error", field: "source_type", message: "csv/pdf/manualのいずれかを指定してください。" });
  }

  if (question.choices.length === 0) {
    issues.push({ severity: "error", field: "choices", message: "選択肢が空です。" });
  }
  if (question.status === "active" && question.choices.length > 0 && question.choices.length < 4) {
    issues.push({ severity: "warning", field: "choices", message: "選択肢が4個未満です。抽出内容を確認してください。" });
  }
  if (question.status === "active" && question.choices.length > 6) {
    issues.push({ severity: "warning", field: "choices", message: "選択肢が多めです。PDF抽出ノイズが混ざっていないか確認してください。" });
  }

  const choiceKeys = new Set<string>();
  question.choices.forEach((choice) => {
    if (!choice.key.trim() || !choice.text.trim()) {
      issues.push({ severity: "error", field: "choices", message: "空の選択肢があります。" });
    }
    if (choice.key.trim()) {
      if (choiceKeys.has(choice.key)) {
        issues.push({ severity: "error", field: "choices", message: `選択肢 ${choice.key} が重複しています。` });
      }
      choiceKeys.add(choice.key);
    }
  });

  if (question.correctAnswers.length === 0 && question.status === "active") {
    issues.push({ severity: "error", field: "correct_answers", message: "active問題には正答が必要です。" });
  }
  if (question.answerMode === "single" && question.correctAnswers.length > 1) {
    issues.push({
      severity: "error",
      field: "answer_mode",
      message: "single問題に複数正答が指定されています。"
    });
  }
  question.correctAnswers.forEach((answer) => {
    if (!choiceKeys.has(answer)) {
      issues.push({
        severity: "error",
        field: "correct_answers",
        message: `正答 ${answer} が選択肢に存在しません。`
      });
    }
  });

  if (options.warnOnMissingExplanation && !question.explanation?.trim()) {
    issues.push({ severity: "warning", field: "explanation", message: "ローカル取込解説が未登録です。" });
  }
  if (options.warnOnMissingTags && question.tags.length === 0) {
    issues.push({ severity: "warning", field: "tags", message: "タグが未登録です。" });
  }
  if (options.warnOnAssetReferences) {
    issues.push({
      severity: "warning",
      field: "assets",
      message: "画像参照がありますが、v1ではCSVからの画像取込は行いません。"
    });
  }

  return issues;
}

export function hasValidationErrors(issues: ValidationIssue[]) {
  return issues.some((issue) => issue.severity === "error");
}
