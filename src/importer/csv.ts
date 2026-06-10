import Papa from "papaparse";
import { createId, db, nowIso } from "../db";
import { parseChoices, parseStringList } from "../questionParsing";
import {
  ImportDuplicateMode,
  ImportIssue,
  ImportJob,
  ImportPreview,
  Question,
  SourceType
} from "../types";
import { validateQuestion, ValidationIssue } from "../validation";

export { parseChoices, parseStringList } from "../questionParsing";

type CsvRow = Record<string, string | undefined>;

interface ParseCsvOptions {
  duplicateMode?: ImportDuplicateMode;
}

function text(row: CsvRow, key: string) {
  return (row[key] ?? "").trim();
}

function addIssue(
  issues: ImportIssue[],
  row: number,
  questionId: string | undefined,
  severity: ImportIssue["severity"],
  field: string,
  message: string
) {
  issues.push({ row, questionId, severity, field, message });
}

function addValidationIssues(
  issues: ImportIssue[],
  row: number,
  questionId: string | undefined,
  validationIssues: ValidationIssue[]
) {
  validationIssues.forEach((issue) => {
    addIssue(issues, row, questionId, issue.severity, issue.field, issue.message);
  });
}

export async function parseCsvToPreview(
  sourceName: string,
  csvText: string,
  options: ParseCsvOptions = {}
): Promise<ImportPreview> {
  const duplicateMode = options.duplicateMode ?? "add";
  const existingIds = new Set((await db.questions.toArray()).map((question) => question.id));
  const seenIds = new Set<string>();
  const questions: Question[] = [];
  const issues: ImportIssue[] = [];
  const parsed = Papa.parse<CsvRow>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim()
  });

  if (parsed.errors.length > 0) {
    parsed.errors.forEach((error) => {
      addIssue(issues, (error.row ?? 0) + 2, undefined, "error", "csv", error.message);
    });
  }

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const rowIssuesStart = issues.length;
    const id = text(row, "question_id");
    const sourceType = (text(row, "source_type") || "csv") as SourceType;
    const page = text(row, "page") ? Number(text(row, "page")) : undefined;
    let choices: Question["choices"] = [];
    let correctAnswers: string[] = [];
    let tags: string[] = [];
    let skipRow = false;

    if (id && seenIds.has(id)) {
      addIssue(issues, rowNumber, id, "error", "question_id", "CSV内で重複しています。");
    }
    if (id && existingIds.has(id)) {
      if (duplicateMode === "add") {
        addIssue(issues, rowNumber, id, "error", "question_id", "既存問題と重複しています。");
      } else if (duplicateMode === "skip") {
        addIssue(issues, rowNumber, id, "warning", "question_id", "既存IDのためスキップします。");
        skipRow = true;
      }
    }
    if (skipRow) {
      if (id) seenIds.add(id);
      return;
    }

    try {
      choices = parseChoices(text(row, "choices"));
    } catch (error) {
      addIssue(issues, rowNumber, id, "error", "choices", `choicesの解析に失敗しました: ${(error as Error).message}`);
    }
    try {
      correctAnswers = parseStringList(text(row, "correct_answers"));
    } catch (error) {
      addIssue(
        issues,
        rowNumber,
        id,
        "error",
        "correct_answers",
        `correct_answersの解析に失敗しました: ${(error as Error).message}`
      );
    }
    try {
      tags = parseStringList(text(row, "tags"));
    } catch (error) {
      addIssue(issues, rowNumber, id, "warning", "tags", `tagsの解析に失敗しました: ${(error as Error).message}`);
    }

    const updatedAt = text(row, "updated_at") || nowIso();
    const question: Question = {
      id,
      year: Number(text(row, "year")),
      number: Number(text(row, "number")),
      stem: text(row, "stem"),
      choices,
      correctAnswers,
      answerMode: text(row, "answer_mode") as Question["answerMode"],
      explanation: text(row, "explanation") || undefined,
      explanationSource: text(row, "explanation_source") as Question["explanationSource"],
      tags,
      status: text(row, "status") as Question["status"],
      sourceNote: text(row, "source_note") || undefined,
      sourceType,
      page: Number.isFinite(page) ? page : undefined,
      createdAt: updatedAt,
      updatedAt
    };

    addValidationIssues(
      issues,
      rowNumber,
      id,
      validateQuestion(question, {
        warnOnMissingExplanation: true,
        warnOnMissingTags: true,
        warnOnAssetReferences: Boolean(text(row, "assets"))
      })
    );

    if (id) seenIds.add(id);
    const rowIssues = issues.slice(rowIssuesStart);
    const hasError = rowIssues.some((issue) => issue.severity === "error");
    if (!hasError && !skipRow) questions.push(question);
  });

  return {
    sourceName,
    duplicateMode,
    questions,
    issues,
    summary: {
      success: questions.length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      errors: issues.filter((issue) => issue.severity === "error").length,
      skipped: parsed.data.length - questions.length,
      totalRows: parsed.data.length
    }
  };
}

export async function commitImportPreview(preview: ImportPreview): Promise<ImportJob> {
  const jobId = createId("import");
  const questionsToCommit = preview.questions.map((question) => ({
    ...question,
    importJobId: jobId
  }));
  const job: ImportJob = {
    id: jobId,
    sourceName: preview.sourceName,
    sourceType: "csv",
    importedAt: nowIso(),
    status: "committed",
    schemaVersion: 1,
    successCount: preview.summary.success,
    warningCount: preview.summary.warnings,
    errorCount: preview.summary.errors,
    questionIds: questionsToCommit.map((question) => question.id)
  };

  await db.transaction("rw", db.questions, db.importJobs, async () => {
    await db.questions.bulkPut(questionsToCommit);
    await db.importJobs.add(job);
  });
  return job;
}

export async function deleteImportJobQuestions(job: ImportJob): Promise<number> {
  const questionIds = [...new Set(job.questionIds ?? [])].filter(Boolean);
  if (questionIds.length === 0) {
    throw new Error("この取込履歴には削除対象の問題IDが記録されていません。");
  }
  const existingQuestions = await db.questions.bulkGet(questionIds);
  const targetIds = existingQuestions
    .filter((question): question is Question => Boolean(question && question.importJobId === job.id))
    .map((question) => question.id);
  if (targetIds.length === 0) {
    return 0;
  }

  const archivedAt = nowIso();
  const questionsToArchive = existingQuestions
    .filter((question): question is Question => Boolean(question && question.importJobId === job.id))
    .map((question) => ({
      ...question,
      status: "deleted" as const,
      updatedAt: archivedAt
    }));

  await db.transaction("rw", [db.questions, db.importJobs], async () => {
    await db.questions.bulkPut(questionsToArchive);
    await db.importJobs.put({
      ...job,
      status: "committed",
      questionIds: targetIds
    });
  });

  return targetIds.length;
}
