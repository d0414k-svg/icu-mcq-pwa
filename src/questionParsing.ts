import { Choice } from "./types";

const LETTER_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function parseJsonArray(input: string): unknown[] | null {
  if (!input.trim().startsWith("[")) return null;
  const parsed = JSON.parse(input);
  if (!Array.isArray(parsed)) throw new Error("JSON配列ではありません。");
  return parsed;
}

export function parseChoices(input: string): Choice[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const json = parseJsonArray(trimmed);
  if (json) {
    return json.map((item, index) => {
      if (typeof item === "string") return { key: LETTER_KEYS[index] ?? String(index + 1), text: item.trim() };
      const value = item as Partial<Choice>;
      return {
        key: String(value.key ?? LETTER_KEYS[index] ?? index + 1).trim(),
        text: String(value.text ?? "").trim()
      };
    });
  }

  return trimmed
    .split("||")
    .map((part, index) => {
      const match = part.trim().match(/^([A-Za-z0-9]+)[\.\):：、]\s*(.+)$/u);
      if (match) return { key: match[1].trim(), text: match[2].trim() };
      return { key: LETTER_KEYS[index] ?? String(index + 1), text: part.trim() };
    })
    .filter((choice) => choice.key && choice.text);
}

export function parseStringList(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const json = parseJsonArray(trimmed);
  if (json) return json.map((item) => String(item).trim()).filter(Boolean);

  return trimmed
    .split(/[,，、;]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface PastedQuestionDraft {
  stem: string;
  choices: Choice[];
  correctAnswers: string[];
  explanation?: string;
  tags: string[];
}

export function parsePastedQuestionBlock(input: string): PastedQuestionDraft {
  const lines = input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const choiceLines: string[] = [];
  const stemLines: string[] = [];
  const explanationLines: string[] = [];
  let correctAnswers: string[] = [];
  let tags: string[] = [];
  let mode: "stem" | "explanation" = "stem";

  lines.forEach((line) => {
    const answerMatch = line.match(/^(?:answer|ans|正答|解答)\s*[:：]\s*(.+)$/iu);
    if (answerMatch) {
      correctAnswers = parseStringList(answerMatch[1]);
      return;
    }

    const tagsMatch = line.match(/^(?:tags?|タグ|分野)\s*[:：]\s*(.+)$/iu);
    if (tagsMatch) {
      tags = parseStringList(tagsMatch[1]);
      return;
    }

    if (/^(?:explanation|解説|メモ)\s*[:：]?$/iu.test(line)) {
      mode = "explanation";
      return;
    }

    if (/^[A-Za-z0-9]+[\.\):：、]\s*.+$/u.test(line)) {
      choiceLines.push(line);
      return;
    }

    if (mode === "explanation") {
      explanationLines.push(line);
    } else {
      stemLines.push(line);
    }
  });

  return {
    stem: stemLines.join("\n"),
    choices: parseChoices(choiceLines.join(" || ")),
    correctAnswers,
    explanation: explanationLines.join("\n") || undefined,
    tags
  };
}
