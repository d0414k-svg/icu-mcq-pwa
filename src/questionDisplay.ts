import { Question, QuestionState, SourceType } from "./types";

const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  csv: "CSV",
  pdf: "PDF",
  manual: "手入力"
};

export function sourceTypeLabel(sourceType: SourceType) {
  return SOURCE_TYPE_LABEL[sourceType] ?? sourceType;
}

export function questionPathLabel(question: Pick<Question, "sourceType" | "year" | "number" | "page">) {
  const parts = [sourceTypeLabel(question.sourceType), `${question.year}年`, `問${question.number}`];
  if (question.page) parts.push(`p.${question.page}`);
  return parts.join(" / ");
}

export function questionSourceDetail(question: Pick<Question, "sourceNote" | "page" | "sourceType">) {
  const details = [question.sourceNote?.trim(), question.page ? `p.${question.page}` : ""].filter(Boolean);
  return details.length > 0 ? details.join(" / ") : sourceTypeLabel(question.sourceType);
}

export function accuracyLabel(state?: QuestionState) {
  const correct = state?.correctCount ?? 0;
  const wrong = state?.wrongCount ?? 0;
  const total = correct + wrong;
  if (total === 0) return "未回答";
  return `${Math.round((correct / total) * 100)}%`;
}
