import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..", "..");
const pubmedSourcePath = resolve(rootDir, "src", "pubmed.ts");
const generatedPath = resolve(rootDir, "src", "pubmedGenerated.ts");

const EUTILS_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const EUTILS_TOOL = "icu_mcq_pwa";
const ALERT_RETMAX = clampNumber(process.env.PUBMED_ALERT_RETMAX, 20, 1, 50);
const IMPORTANT_RETMAX = clampNumber(process.env.PUBMED_IMPORTANT_RETMAX, 12, 1, 20);
const IMPORTANT_LOOKBACK_MONTHS = clampNumber(process.env.PUBMED_IMPORTANT_LOOKBACK_MONTHS, 24, 1, 36);
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const NCBI_EMAIL = process.env.NCBI_EMAIL || "";

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function compactText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, number) => String.fromCodePoint(Number.parseInt(number, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanXmlText(value = "") {
  return compactText(decodeXml(value.replace(/<[^>]+>/g, " ")));
}

function firstText(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? cleanXmlText(match[1]) : "";
}

function allBlocks(block, tagName) {
  return [...block.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "gi"))].map((match) => match[1]);
}

function extractAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1] ?? "";
}

function parsePublicationDate(articleBlock) {
  const pubDate = articleBlock.match(/<JournalIssue\b[\s\S]*?<PubDate\b[^>]*>([\s\S]*?)<\/PubDate>[\s\S]*?<\/JournalIssue>/i)?.[1] ?? "";
  const medlineDate = firstText(pubDate, "MedlineDate");
  if (medlineDate) return medlineDate;
  return [firstText(pubDate, "Year"), firstText(pubDate, "Month"), firstText(pubDate, "Day")].filter(Boolean).join(" ");
}

function parseAuthors(articleBlock) {
  return allBlocks(articleBlock, "Author")
    .slice(0, 6)
    .map((author) => compactText([firstText(author, "LastName"), firstText(author, "Initials")].join(" ")))
    .filter(Boolean);
}

function parseAbstract(articleBlock) {
  return [...articleBlock.matchAll(/<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi)]
    .map((match) => {
      const label = extractAttribute(match[1], "Label");
      const text = cleanXmlText(match[2]);
      return label && text ? `${label}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function parseDoi(articleBlock) {
  const match = [...articleBlock.matchAll(/<ArticleId\b([^>]*)>([\s\S]*?)<\/ArticleId>/gi)].find(
    (item) => extractAttribute(item[1], "IdType") === "doi"
  );
  return match ? cleanXmlText(match[2]) : undefined;
}

function parsePubMedXml(xml) {
  return [...xml.matchAll(/<PubmedArticle\b[^>]*>([\s\S]*?)<\/PubmedArticle>/gi)]
    .map((match) => {
      const article = match[1];
      const pmid = firstText(article, "PMID");
      return {
        pmid,
        title: firstText(article, "ArticleTitle"),
        journal: firstText(article, "ISOAbbreviation") || firstText(article, "Title") || firstText(article, "MedlineTA"),
        publicationDate: parsePublicationDate(article),
        authors: parseAuthors(article),
        abstract: parseAbstract(article),
        doi: parseDoi(article),
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
      };
    })
    .filter((article) => article.pmid && article.title);
}

function extractQuery(source, key) {
  const keyIndex = source.indexOf(`key: "${key}"`);
  if (keyIndex === -1) throw new Error(`Could not find PubMed alert key: ${key}`);
  const queryIndex = source.indexOf("query:", keyIndex);
  const start = source.indexOf("'", queryIndex);
  if (queryIndex === -1 || start === -1) throw new Error(`Could not find query for PubMed alert: ${key}`);

  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'" && source[index - 1] !== "\\") return value.replace(/\\'/g, "'");
    value += char;
  }
  throw new Error(`Unterminated query for PubMed alert: ${key}`);
}

function requestParams() {
  const params = new URLSearchParams({ tool: EUTILS_TOOL });
  if (NCBI_EMAIL.trim()) params.set("email", NCBI_EMAIL.trim());
  return params;
}

async function searchPubMedIds(query, { retmax, sort }) {
  const params = requestParams();
  params.set("db", "pubmed");
  params.set("term", query);
  params.set("retmax", String(retmax));
  params.set("retmode", "json");
  params.set("sort", sort);

  const response = await fetch(`${EUTILS_BASE_URL}/esearch.fcgi`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) throw new Error(`PubMed search failed: ${response.status}`);
  const payload = await response.json();
  return payload.esearchresult?.idlist ?? [];
}

async function fetchPubMedArticlesByIds(ids) {
  if (ids.length === 0) return [];
  const params = requestParams();
  params.set("db", "pubmed");
  params.set("id", ids.join(","));
  params.set("retmode", "xml");

  const response = await fetch(`${EUTILS_BASE_URL}/efetch.fcgi?${params.toString()}`);
  if (!response.ok) throw new Error(`PubMed fetch failed: ${response.status}`);
  return parsePubMedXml(await response.text());
}

function pubMedDate(value) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("/");
}

function monthsAgo(months, now) {
  const value = new Date(now);
  value.setMonth(value.getMonth() - months);
  return value;
}

function importantQuery(alerts, now) {
  const from = pubMedDate(monthsAgo(IMPORTANT_LOOKBACK_MONTHS, now));
  const to = pubMedDate(now);
  const combined = alerts.map((alert) => `(${alert.query})`).join(" OR ");
  return `( ${combined} ) AND ("${from}"[dp] : "${to}"[dp])`;
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function articleBlocks(articles, maxArticles, abstractLength) {
  return articles
    .slice(0, maxArticles)
    .map((article, index) =>
      [
        `#${index + 1}`,
        `PMID: ${article.pmid}`,
        `Title: ${article.title}`,
        `Journal: ${article.journal || "unknown"} (${article.publicationDate || "date unknown"})`,
        `Authors: ${article.authors.join(", ") || "unknown"}`,
        `Abstract: ${truncate(article.abstract || "No abstract available.", abstractLength)}`
      ].join("\n")
    )
    .join("\n\n");
}

async function requestOpenAiText(input, instructions) {
  if (!OPENAI_API_KEY.trim()) {
    throw new Error("OPENAI_API_KEY is required for automatic AI summaries.");
  }

  const baseUrl = OPENAI_BASE_URL.trim().replace(/\/+$/, "");
  const endpoint = baseUrl.endsWith("/responses")
    ? baseUrl
    : baseUrl.endsWith("/v1")
      ? `${baseUrl}/responses`
      : `${baseUrl}/v1/responses`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY.trim()}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "low" },
      instructions,
      input
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed: ${response.status}`;
    throw new Error(message);
  }

  const outputText =
    payload.output_text ||
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .filter(Boolean)
      .join("\n") ||
    "";
  if (!outputText.trim()) throw new Error("OpenAI returned an empty summary.");
  return outputText.trim();
}

function alertSummaryPrompt(alert, articles) {
  return [
    `PubMed alert: ${alert.title}`,
    "Audience: pediatric intensivists and pediatric cardiac intensivists.",
    "Task: Summarize these newly retrieved PubMed records in Japanese.",
    "",
    "Output format:",
    "1. 最重要ポイント: 3-5 bullets",
    "2. 論文別メモ: PMID, 1-2 sentence summary, clinical relevance, limitation/caveat",
    "3. PICU/CICUで明日から気にすること",
    "4. 優先して読む順",
    "",
    "Do not overstate findings. If only abstracts are available, say so.",
    "",
    articleBlocks(articles, 10, 1400)
  ].join("\n");
}

function importantSummaryPrompt(articles) {
  return [
    `Scope: Important pediatric critical care / pediatric cardiac intensive care papers from the last ${IMPORTANT_LOOKBACK_MONTHS} months.`,
    "Audience: pediatric intensivists and pediatric cardiac intensivists.",
    "Task: Select and summarize the most important papers from the provided PubMed records in Japanese.",
    "",
    "Rank by likely clinical relevance, practice-changing potential, methodological strength, journal/context, and relevance to PICU/CICU.",
    "Do not treat every paper as equally important. It is acceptable to say that some records look low priority.",
    "",
    "Output format:",
    "1. 今回の最重要論文: top 5-8 papers, each with PMID, one-line finding, why it matters, and caveat",
    "2. テーマ別まとめ: respiratory, sepsis/shock, ECMO/ECLS, AKI/CRRT, sedation/delirium, congenital heart/CICU as applicable",
    "3. すぐ読むべき順",
    "4. 後回しでよいもの / 抄録だけでは判断困難なもの",
    "",
    "If only abstracts are available, explicitly say so and avoid overstating causality.",
    "",
    articleBlocks(articles, 18, 1300)
  ].join("\n");
}

function generatedModule(cache, generatedAt) {
  return `import type { PubMedCachePayload } from "./pubmed";

export const GENERATED_PUBMED_CACHE_VERSION = ${JSON.stringify(generatedAt)};

export const GENERATED_PUBMED_CACHE: PubMedCachePayload = ${JSON.stringify(cache, null, 2)};
`;
}

async function main() {
  const source = await readFile(pubmedSourcePath, "utf8");
  const alerts = [
    {
      key: "focused",
      title: "PICU/CICU重点",
      query: extractQuery(source, "focused")
    },
    {
      key: "broad",
      title: "主要誌横断",
      query: extractQuery(source, "broad")
    }
  ];

  const generatedAt = new Date().toISOString();
  const articlesByAlert = { focused: [], broad: [] };
  const summaryByAlert = {};
  const fetchedAtByAlert = {};
  const statusMessages = [];

  for (const alert of alerts) {
    const ids = await searchPubMedIds(alert.query, { retmax: ALERT_RETMAX, sort: "pub_date" });
    const articles = await fetchPubMedArticlesByIds(ids);
    articlesByAlert[alert.key] = articles;
    fetchedAtByAlert[alert.key] = generatedAt;
    statusMessages.push(`${alert.title}: ${articles.length}件取得`);

    if (articles.length > 0) {
      summaryByAlert[alert.key] = await requestOpenAiText(
        alertSummaryPrompt(alert, articles),
        "You are a careful medical literature summarizer. Write concise Japanese for clinicians. Do not provide individual medical advice."
      );
      statusMessages.push(`${alert.title}: AI要約済み`);
    }
  }

  const importantIds = await searchPubMedIds(importantQuery(alerts, new Date(generatedAt)), {
    retmax: IMPORTANT_RETMAX,
    sort: "relevance"
  });
  const importantArticles = await fetchPubMedArticlesByIds(importantIds);
  let importantSummary = undefined;
  if (importantArticles.length > 0) {
    importantSummary = await requestOpenAiText(
      importantSummaryPrompt(importantArticles),
      "You are a careful medical literature curator for pediatric intensive care and pediatric cardiac intensive care. Write concise Japanese for clinicians, rank priorities, and avoid overstatement."
    );
  }

  const cache = {
    articlesByAlert,
    summaryByAlert,
    fetchedAtByAlert,
    importantArticles,
    importantSummary,
    importantFetchedAt: generatedAt,
    lastAutoRunAt: generatedAt,
    lastAutoRunDate: generatedAt.slice(0, 10),
    lastAutoRunStatus: statusMessages.join(" / "),
    lastImportantRunAt: generatedAt,
    lastImportantRunStatus: `重要論文候補 ${importantArticles.length}件取得${importantSummary ? " / AI要約済み" : ""}`
  };

  await writeFile(generatedPath, generatedModule(cache, generatedAt), "utf8");
  console.log(`Updated ${generatedPath}`);
  console.log(cache.lastAutoRunStatus);
  console.log(cache.lastImportantRunStatus);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
