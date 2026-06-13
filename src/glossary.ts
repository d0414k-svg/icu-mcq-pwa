export type GlossaryCategory = "疾患" | "スコア" | "治療" | "検査" | "概念" | "その他";

export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  category: GlossaryCategory;
  summary: string;
  bullets: string[];
  sourceNote?: string;
  builtIn?: boolean;
  updatedAt: string;
}

export interface GlossarySegment {
  text: string;
  entry?: GlossaryEntry;
}

const UPDATED_AT = "2026-06-13T00:00:00.000Z";

export const BUILT_IN_GLOSSARY: GlossaryEntry[] = [
  {
    id: "builtin-sepsis",
    term: "敗血症",
    aliases: ["sepsis"],
    category: "疾患",
    summary: "感染に対する宿主反応の調節異常により、生命を脅かす臓器障害をきたす状態。",
    bullets: ["感染巣、循環、臓器障害、抗菌薬、ソースコントロールをセットで確認する。"],
    sourceNote: "一般学習メモ。診療判断では最新の原典を確認してください。",
    builtIn: true,
    updatedAt: UPDATED_AT
  },
  {
    id: "builtin-sofa",
    term: "SOFA",
    aliases: ["Sequential Organ Failure Assessment"],
    category: "スコア",
    summary: "呼吸、凝固、肝、循環、中枢神経、腎の6臓器を評価する臓器障害スコア。",
    bullets: ["総点だけでなく、どの臓器で点が上がっているかを見ると復習しやすい。"],
    sourceNote: "一般学習メモ。",
    builtIn: true,
    updatedAt: UPDATED_AT
  },
  {
    id: "builtin-qsofa",
    term: "qSOFA",
    aliases: ["quick SOFA"],
    category: "スコア",
    summary: "感染症患者の重症化リスクをベッドサイドで素早く拾うための簡易指標。",
    bullets: ["意識、呼吸数、血圧の要素をまとめて思い出す。SOFAそのものとは用途が異なる。"],
    sourceNote: "一般学習メモ。",
    builtIn: true,
    updatedAt: UPDATED_AT
  },
  {
    id: "builtin-ards",
    term: "ARDS",
    aliases: ["急性呼吸窮迫症候群"],
    category: "疾患",
    summary: "急性に生じる低酸素性呼吸不全の代表的病態。酸素化、画像、心原性浮腫との区別を確認する。",
    bullets: ["問題ではP/F比、PEEP、人工呼吸設定、原因疾患がセットで問われやすい。"],
    sourceNote: "一般学習メモ。",
    builtIn: true,
    updatedAt: UPDATED_AT
  },
  {
    id: "builtin-pf-ratio",
    term: "P/F比",
    aliases: ["PaO2/FiO2", "P/F"],
    category: "検査",
    summary: "動脈血酸素分圧を吸入酸素濃度で割った酸素化の指標。",
    bullets: ["FiO2の単位を小数で扱う点に注意する。例: 40%は0.4。"],
    sourceNote: "一般学習メモ。",
    builtIn: true,
    updatedAt: UPDATED_AT
  },
  {
    id: "builtin-rass",
    term: "RASS",
    aliases: ["Richmond Agitation-Sedation Scale"],
    category: "スコア",
    summary: "鎮静深度と興奮を評価するスケール。ICU鎮静管理で頻用される。",
    bullets: ["深鎮静、浅鎮静、興奮の方向を混同しないように整理する。"],
    sourceNote: "一般学習メモ。",
    builtIn: true,
    updatedAt: UPDATED_AT
  },
  {
    id: "builtin-cam-icu",
    term: "CAM-ICU",
    aliases: ["CAM ICU"],
    category: "スコア",
    summary: "ICU患者のせん妄評価に用いられる評価法。",
    bullets: ["意識レベル、注意、急性変化、思考のまとまりを関連づけて復習する。"],
    sourceNote: "一般学習メモ。",
    builtIn: true,
    updatedAt: UPDATED_AT
  },
  {
    id: "builtin-apache2",
    term: "APACHE II",
    aliases: ["APACHE2"],
    category: "スコア",
    summary: "重症度評価に用いられるスコア。生理学的異常、年齢、慢性健康状態を組み合わせる。",
    bullets: ["個々の治療判断そのものではなく、重症度の層別化として押さえる。"],
    sourceNote: "一般学習メモ。",
    builtIn: true,
    updatedAt: UPDATED_AT
  }
];

function cleanEntry(entry: GlossaryEntry): GlossaryEntry {
  return {
    ...entry,
    term: entry.term.trim(),
    aliases: entry.aliases.map((alias) => alias.trim()).filter(Boolean),
    summary: entry.summary.trim(),
    bullets: entry.bullets.map((bullet) => bullet.trim()).filter(Boolean),
    sourceNote: entry.sourceNote?.trim() || undefined
  };
}

export function normalizeGlossaryEntries(entries: GlossaryEntry[]) {
  return entries
    .map(cleanEntry)
    .filter((entry) => entry.term && entry.summary)
    .sort((left, right) => left.term.localeCompare(right.term, "ja"));
}

export function mergeGlossaryEntries(customEntries: GlossaryEntry[]) {
  const merged = new Map<string, GlossaryEntry>();
  for (const entry of BUILT_IN_GLOSSARY) merged.set(entry.id, entry);
  for (const entry of normalizeGlossaryEntries(customEntries)) merged.set(entry.id, { ...entry, builtIn: false });
  return [...merged.values()].sort((left, right) => left.term.localeCompare(right.term, "ja"));
}

function isAsciiWordChar(value: string) {
  return /^[A-Za-z0-9-]$/.test(value);
}

function needsWordBoundary(term: string) {
  return /^[A-Za-z0-9][A-Za-z0-9+\-/.\s]*[A-Za-z0-9]$/.test(term);
}

function matchesAt(text: string, index: number, needle: string) {
  const candidate = text.slice(index, index + needle.length);
  if (candidate.toLocaleLowerCase() !== needle.toLocaleLowerCase()) return false;
  if (!needsWordBoundary(needle)) return true;
  const before = index > 0 ? text[index - 1] : "";
  const after = text[index + needle.length] ?? "";
  return !isAsciiWordChar(before) && !isAsciiWordChar(after);
}

export function splitTextByGlossary(text: string, entries: GlossaryEntry[]): GlossarySegment[] {
  const terms = entries
    .flatMap((entry) => [entry.term, ...entry.aliases].map((label) => ({ label: label.trim(), entry })))
    .filter((item) => item.label)
    .sort((left, right) => right.label.length - left.label.length);

  const segments: GlossarySegment[] = [];
  let buffer = "";
  let index = 0;

  while (index < text.length) {
    const match = terms.find((item) => matchesAt(text, index, item.label));
    if (!match) {
      buffer += text[index];
      index += 1;
      continue;
    }
    if (buffer) {
      segments.push({ text: buffer });
      buffer = "";
    }
    segments.push({ text: text.slice(index, index + match.label.length), entry: match.entry });
    index += match.label.length;
  }

  if (buffer) segments.push({ text: buffer });
  return segments;
}
