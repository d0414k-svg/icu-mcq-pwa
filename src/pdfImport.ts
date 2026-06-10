import { TextItem } from "pdfjs-dist/types/src/display/api";
import { parsePastedQuestionBlock, PastedQuestionDraft } from "./questionParsing";

export interface PdfQuestionDraft extends PastedQuestionDraft {
  sourcePage: number;
  rawText: string;
}

function isTextItem(item: unknown): item is TextItem {
  return typeof item === "object" && item !== null && "str" in item;
}

function normalizePdfText(text: string) {
  return text
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function splitQuestionBlocks(pageText: string): string[] {
  const lines = pageText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: string[] = [];
  let current: string[] = [];
  const startPattern = /^(?:問\s*)?\d{1,3}[\.\)．、\s]|^(?:Q|No\.?)\s*\d{1,3}[\.\)．、\s]/iu;

  lines.forEach((line) => {
    if (startPattern.test(line) && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [line.replace(startPattern, "").trim() || line];
      return;
    }
    current.push(line);
  });

  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks.filter((block) => /(^|\n)[A-Za-z0-9]+[\.\):：、]\s*.+/u.test(block));
}

export async function extractQuestionDraftsFromPdf(file: File): Promise<PdfQuestionDraft[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const drafts: PdfQuestionDraft[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = normalizePdfText(
      content.items
        .filter(isTextItem)
        .map((item) => item.str)
        .join("\n")
    );
    splitQuestionBlocks(pageText).forEach((block) => {
      const parsed = parsePastedQuestionBlock(block);
      drafts.push({
        ...parsed,
        sourcePage: pageNumber,
        rawText: block
      });
    });
  }

  return drafts;
}
