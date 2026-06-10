import { GENERATED_PUBMED_CACHE } from "./pubmedGenerated";

export type PubMedAlertKey = "focused" | "broad";

export interface PubMedAlertDefinition {
  key: PubMedAlertKey;
  title: string;
  subtitle: string;
  query: string;
}

export interface PubMedArticle {
  pmid: string;
  title: string;
  journal: string;
  publicationDate: string;
  authors: string[];
  abstract: string;
  doi?: string;
  url: string;
}

export interface PubMedSettings {
  apiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  aiEndpointMode: "responses" | "chat";
  eutilsEmail: string;
  retmax: number;
  dailyRunEnabled: boolean;
  dailyRunTime: string;
  dailyRunSummaries: boolean;
  importantRunEnabled: boolean;
  importantRunIntervalDays: number;
  importantLookbackMonths: number;
  importantRetmax: number;
}

export interface PubMedCachePayload {
  articlesByAlert: Record<PubMedAlertKey, PubMedArticle[]>;
  summaryByAlert: Partial<Record<PubMedAlertKey, string>>;
  fetchedAtByAlert: Partial<Record<PubMedAlertKey, string>>;
  importantArticles: PubMedArticle[];
  importantSummary?: string;
  importantFetchedAt?: string;
  lastAutoRunAt?: string;
  lastAutoRunDate?: string;
  lastAutoRunStatus?: string;
  lastImportantRunAt?: string;
  lastImportantRunStatus?: string;
}

export const DEFAULT_PUBMED_SETTINGS: PubMedSettings = {
  apiKey: "",
  aiBaseUrl: "https://api.openai.com/v1",
  aiModel: "gpt-5.5",
  aiEndpointMode: "responses",
  eutilsEmail: "",
  retmax: 5,
  dailyRunEnabled: true,
  dailyRunTime: "07:00",
  dailyRunSummaries: true,
  importantRunEnabled: true,
  importantRunIntervalDays: 7,
  importantLookbackMonths: 24,
  importantRetmax: 5
};

const PUBMED_SETTINGS_STORAGE_KEY = "icu-mcq-pubmed-settings";
const PUBMED_CACHE_STORAGE_KEY = "icu-mcq-pubmed-cache";
export const PUBMED_CACHE_EVENT = "icu-mcq-pubmed-cache-updated";
const EUTILS_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const EUTILS_TOOL = "icu_mcq_pwa";

export const PUBMED_ALERTS: PubMedAlertDefinition[] = [
  {
    key: "focused",
    title: "PICU/CICU重点",
    subtitle: "小児集中治療・小児循環器誌と主要小児誌の集中治療関連",
    query:
      '( ( "Pediatr Crit Care Med"[ta] OR "Pediatr Cardiol"[ta] OR "Cardiol Young"[ta] OR "Congenit Heart Dis"[ta] OR "World J Pediatr Congenit Heart Surg"[ta] ) OR ( ( "Pediatrics"[ta] OR "JAMA Pediatr"[ta] OR "Lancet Child Adolesc Health"[ta] OR "J Pediatr"[ta] OR "Pediatr Res"[ta] OR "Arch Dis Child"[ta] ) AND ( "critical care"[tiab] OR "intensive care"[tiab] OR ICU[tiab] OR PICU[tiab] OR CICU[tiab] OR "pediatric intensive care"[tiab] OR "paediatric intensive care"[tiab] OR "cardiac intensive care"[tiab] OR "cardiovascular intensive care"[tiab] OR "respiratory failure"[tiab] OR "mechanical ventilation"[tiab] OR ventilat*[tiab] OR extubat*[tiab] OR ARDS[tiab] OR "acute respiratory distress syndrome"[tiab] OR sepsis[tiab] OR "septic shock"[tiab] OR shock[tiab] OR vasopressor*[tiab] OR inotrope*[tiab] OR ECMO[tiab] OR ECLS[tiab] OR "extracorporeal membrane oxygenation"[tiab] OR CRRT[tiab] OR "renal replacement therapy"[tiab] OR "acute kidney injury"[tiab] OR AKI[tiab] OR delirium[tiab] OR sedation[tiab] OR analgesia[tiab] OR "congenital heart"[tiab] OR "congenital cardiac"[tiab] OR CHD[tiab] OR "pediatric cardiology"[tiab] OR "paediatric cardiology"[tiab] OR Fontan[tiab] OR Norwood[tiab] OR Glenn[tiab] OR "single ventricle"[tiab] OR "pulmonary hypertension"[tiab] OR myocarditis[tiab] OR cardiomyopathy[tiab] OR arrhythmia*[tiab] OR "heart failure"[tiab] OR "cardiac surgery"[tiab] OR "cardiopulmonary bypass"[tiab] OR "ventricular assist"[tiab] OR VAD[tiab] ) ) OR ( ( "N Engl J Med"[ta] OR "Lancet"[ta] OR "JAMA"[ta] OR "BMJ"[ta] OR "Intensive Care Med"[ta] OR "Crit Care Med"[ta] OR "Crit Care"[ta] OR "Am J Respir Crit Care Med"[ta] OR "Ann Intensive Care"[ta] OR "Chest"[ta] OR "J Intensive Care"[ta] OR "Resuscitation"[ta] OR "Circulation"[ta] OR "J Am Coll Cardiol"[ta] OR "Eur Heart J"[ta] OR "JAMA Cardiol"[ta] OR "Heart"[ta] OR "J Am Heart Assoc"[ta] OR "Eur Heart J Acute Cardiovasc Care"[ta] OR "JACC Heart Fail"[ta] OR "Circ Heart Fail"[ta] OR "J Thorac Cardiovasc Surg"[ta] OR "Ann Thorac Surg"[ta] ) AND ( pediatric*[tiab] OR paediatric*[tiab] OR child*[tiab] OR infant*[tiab] OR neonat*[tiab] OR adolescent*[tiab] OR PICU[tiab] OR CICU[tiab] OR "congenital heart"[tiab] OR "congenital cardiac"[tiab] OR CHD[tiab] OR Fontan[tiab] OR Norwood[tiab] OR Glenn[tiab] OR "single ventricle"[tiab] ) AND ( "critical care"[tiab] OR "intensive care"[tiab] OR ICU[tiab] OR PICU[tiab] OR CICU[tiab] OR "cardiac intensive care"[tiab] OR "respiratory failure"[tiab] OR "mechanical ventilation"[tiab] OR ventilat*[tiab] OR ARDS[tiab] OR sepsis[tiab] OR "septic shock"[tiab] OR shock[tiab] OR vasopressor*[tiab] OR inotrope*[tiab] OR ECMO[tiab] OR ECLS[tiab] OR CRRT[tiab] OR "acute kidney injury"[tiab] OR AKI[tiab] OR "congenital heart"[tiab] OR "congenital cardiac"[tiab] OR CHD[tiab] OR Fontan[tiab] OR Norwood[tiab] OR Glenn[tiab] OR "single ventricle"[tiab] OR "pulmonary hypertension"[tiab] OR myocarditis[tiab] OR cardiomyopathy[tiab] OR arrhythmia*[tiab] OR "heart failure"[tiab] OR "cardiac surgery"[tiab] OR "cardiopulmonary bypass"[tiab] OR "ventricular assist"[tiab] OR VAD[tiab] ) ) ) NOT ( animals[mh] NOT humans[mh] )'
  },
  {
    key: "broad",
    title: "主要誌横断",
    subtitle: "主要集中治療・循環器・小児心臓外科誌の関連語検索",
    query:
      '( "N Engl J Med"[ta] OR "Lancet"[ta] OR "JAMA"[ta] OR "BMJ"[ta] OR "Intensive Care Med"[ta] OR "Crit Care Med"[ta] OR "Crit Care"[ta] OR "Am J Respir Crit Care Med"[ta] OR "Ann Intensive Care"[ta] OR "Chest"[ta] OR "J Intensive Care"[ta] OR "Pediatr Crit Care Med"[ta] OR "Circulation"[ta] OR "J Am Coll Cardiol"[ta] OR "Eur Heart J"[ta] OR "JAMA Cardiol"[ta] OR "Heart"[ta] OR "J Am Heart Assoc"[ta] OR "Eur Heart J Acute Cardiovasc Care"[ta] OR "JACC Heart Fail"[ta] OR "Circ Heart Fail"[ta] OR "Pediatr Cardiol"[ta] OR "Cardiol Young"[ta] OR "Congenit Heart Dis"[ta] OR "World J Pediatr Congenit Heart Surg"[ta] OR "J Thorac Cardiovasc Surg"[ta] OR "Ann Thorac Surg"[ta] ) AND ( "critical care"[tiab] OR "intensive care"[tiab] OR ICU[tiab] OR PICU[tiab] OR CICU[tiab] OR "pediatric intensive care"[tiab] OR "paediatric intensive care"[tiab] OR "cardiac intensive care"[tiab] OR "cardiovascular intensive care"[tiab] OR "septic shock"[tiab] OR sepsis[tiab] OR "cardiogenic shock"[tiab] OR shock[tiab] OR "mechanical ventilation"[tiab] OR ventilat*[tiab] OR ARDS[tiab] OR "acute respiratory distress syndrome"[tiab] OR ECMO[tiab] OR ECLS[tiab] OR "extracorporeal membrane oxygenation"[tiab] OR CRRT[tiab] OR "renal replacement therapy"[tiab] OR vasopressor*[tiab] OR inotrope*[tiab] OR "acute kidney injury"[tiab] OR AKI[tiab] OR "congenital heart"[tiab] OR "congenital cardiac"[tiab] OR CHD[tiab] OR "pediatric cardiology"[tiab] OR "paediatric cardiology"[tiab] OR Fontan[tiab] OR Norwood[tiab] OR "single ventricle"[tiab] OR "pulmonary hypertension"[tiab] OR myocarditis[tiab] OR cardiomyopathy[tiab] OR "heart failure"[tiab] OR "cardiac surgery"[tiab] OR "cardiopulmonary bypass"[tiab] ) NOT ( animals[mh] NOT humans[mh] )'
  }
];

export const EMPTY_PUBMED_CACHE: PubMedCachePayload = {
  articlesByAlert: {
    focused: [],
    broad: []
  },
  summaryByAlert: {},
  fetchedAtByAlert: {},
  importantArticles: []
};

function clonePubMedCache(cache: PubMedCachePayload): PubMedCachePayload {
  return {
    articlesByAlert: {
      focused: [...cache.articlesByAlert.focused],
      broad: [...cache.articlesByAlert.broad]
    },
    summaryByAlert: { ...cache.summaryByAlert },
    fetchedAtByAlert: { ...cache.fetchedAtByAlert },
    importantArticles: [...cache.importantArticles],
    importantSummary: cache.importantSummary,
    importantFetchedAt: cache.importantFetchedAt,
    lastAutoRunAt: cache.lastAutoRunAt,
    lastAutoRunDate: cache.lastAutoRunDate,
    lastAutoRunStatus: cache.lastAutoRunStatus,
    lastImportantRunAt: cache.lastImportantRunAt,
    lastImportantRunStatus: cache.lastImportantRunStatus
  };
}

function mergeWithGeneratedPubMedCache(stored?: Partial<PubMedCachePayload>): PubMedCachePayload {
  const generated = clonePubMedCache(GENERATED_PUBMED_CACHE);
  if (!stored) return generated;

  return {
    articlesByAlert: {
      focused:
        stored.articlesByAlert?.focused && stored.articlesByAlert.focused.length > 0
          ? stored.articlesByAlert.focused
          : generated.articlesByAlert.focused,
      broad:
        stored.articlesByAlert?.broad && stored.articlesByAlert.broad.length > 0
          ? stored.articlesByAlert.broad
          : generated.articlesByAlert.broad
    },
    summaryByAlert: { ...generated.summaryByAlert, ...(stored.summaryByAlert ?? {}) },
    fetchedAtByAlert: { ...generated.fetchedAtByAlert, ...(stored.fetchedAtByAlert ?? {}) },
    importantArticles:
      stored.importantArticles && stored.importantArticles.length > 0
        ? stored.importantArticles
        : generated.importantArticles,
    importantSummary: stored.importantSummary ?? generated.importantSummary,
    importantFetchedAt: stored.importantFetchedAt ?? generated.importantFetchedAt,
    lastAutoRunAt: stored.lastAutoRunAt ?? generated.lastAutoRunAt,
    lastAutoRunDate: stored.lastAutoRunDate ?? generated.lastAutoRunDate,
    lastAutoRunStatus: stored.lastAutoRunStatus ?? generated.lastAutoRunStatus,
    lastImportantRunAt: stored.lastImportantRunAt ?? generated.lastImportantRunAt,
    lastImportantRunStatus: stored.lastImportantRunStatus ?? generated.lastImportantRunStatus
  };
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function textContent(parent: Element | Document, selector: string) {
  return compactText(parent.querySelector(selector)?.textContent ?? "");
}

function parsePublicationDate(article: Element) {
  const pubDate = article.querySelector("JournalIssue PubDate");
  if (!pubDate) return "";
  const medlineDate = textContent(pubDate, "MedlineDate");
  if (medlineDate) return medlineDate;
  return [textContent(pubDate, "Year"), textContent(pubDate, "Month"), textContent(pubDate, "Day")]
    .filter(Boolean)
    .join(" ");
}

function parseAuthors(article: Element) {
  return Array.from(article.querySelectorAll("AuthorList Author"))
    .slice(0, 6)
    .map((author) => compactText([textContent(author, "LastName"), textContent(author, "Initials")].join(" ")))
    .filter(Boolean);
}

function parseAbstract(article: Element) {
  return Array.from(article.querySelectorAll("Abstract AbstractText"))
    .map((node) => {
      const label = node.getAttribute("Label");
      const text = compactText(node.textContent ?? "");
      return label && text ? `${label}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function parsePubMedXml(xml: string): PubMedArticle[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error("PubMed XMLを解析できませんでした。");

  return Array.from(document.querySelectorAll("PubmedArticle"))
    .map((article) => {
      const pmid = textContent(article, "PMID");
      const doi =
        Array.from(article.querySelectorAll("ArticleId"))
          .find((node) => node.getAttribute("IdType") === "doi")
          ?.textContent?.trim() || undefined;

      return {
        pmid,
        title: textContent(article, "ArticleTitle"),
        journal:
          textContent(article, "ISOAbbreviation") ||
          textContent(article, "Journal Title") ||
          textContent(article, "MedlineTA"),
        publicationDate: parsePublicationDate(article),
        authors: parseAuthors(article),
        abstract: parseAbstract(article),
        doi,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
      };
    })
    .filter((article) => article.pmid && article.title);
}

function requestParams(settings: Pick<PubMedSettings, "eutilsEmail">) {
  const params = new URLSearchParams({ tool: EUTILS_TOOL });
  if (settings.eutilsEmail.trim()) params.set("email", settings.eutilsEmail.trim());
  return params;
}

async function searchPubMedIds(
  query: string,
  settings: Pick<PubMedSettings, "eutilsEmail">,
  options: { retmax: number; sort: "pub_date" | "relevance" }
): Promise<string[]> {
  const params = requestParams(settings);
  params.set("db", "pubmed");
  params.set("term", query);
  params.set("retmax", String(Math.min(Math.max(options.retmax, 1), 100)));
  params.set("retmode", "json");
  params.set("sort", options.sort);

  const response = await fetch(`${EUTILS_BASE_URL}/esearch.fcgi`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) throw new Error(`PubMed検索に失敗しました (${response.status})。`);

  const payload = (await response.json()) as { esearchresult?: { idlist?: string[] } };
  return payload.esearchresult?.idlist ?? [];
}

async function fetchPubMedArticlesByIds(ids: string[], settings: Pick<PubMedSettings, "eutilsEmail">) {
  if (ids.length === 0) return [];

  const params = requestParams(settings);
  params.set("db", "pubmed");
  params.set("id", ids.join(","));
  params.set("retmode", "xml");

  const response = await fetch(`${EUTILS_BASE_URL}/efetch.fcgi?${params.toString()}`);
  if (!response.ok) throw new Error(`PubMed本文取得に失敗しました (${response.status})。`);
  return parsePubMedXml(await response.text());
}

export async function fetchPubMedArticles(
  alert: PubMedAlertDefinition,
  settings: PubMedSettings
): Promise<PubMedArticle[]> {
  const ids = await searchPubMedIds(alert.query, settings, { retmax: settings.retmax, sort: "pub_date" });
  return fetchPubMedArticlesByIds(ids, settings);
}

export function loadPubMedSettings(): PubMedSettings {
  if (typeof localStorage === "undefined") return DEFAULT_PUBMED_SETTINGS;
  try {
    const stored = JSON.parse(localStorage.getItem(PUBMED_SETTINGS_STORAGE_KEY) ?? "{}") as Partial<PubMedSettings>;
    if (stored.apiKey) {
      const sanitizedStored = { ...stored };
      delete sanitizedStored.apiKey;
      localStorage.setItem(PUBMED_SETTINGS_STORAGE_KEY, JSON.stringify(sanitizedStored));
    }
    return {
      ...DEFAULT_PUBMED_SETTINGS,
      ...stored,
      apiKey: "",
      aiEndpointMode: stored.aiEndpointMode === "chat" ? "chat" : DEFAULT_PUBMED_SETTINGS.aiEndpointMode,
      dailyRunEnabled:
        typeof stored.dailyRunEnabled === "boolean"
          ? stored.dailyRunEnabled
          : DEFAULT_PUBMED_SETTINGS.dailyRunEnabled,
      dailyRunTime:
        typeof stored.dailyRunTime === "string" && /^\d{2}:\d{2}$/.test(stored.dailyRunTime)
          ? stored.dailyRunTime
          : DEFAULT_PUBMED_SETTINGS.dailyRunTime,
      dailyRunSummaries:
        typeof stored.dailyRunSummaries === "boolean"
          ? stored.dailyRunSummaries
          : DEFAULT_PUBMED_SETTINGS.dailyRunSummaries,
      importantRunEnabled:
        typeof stored.importantRunEnabled === "boolean"
          ? stored.importantRunEnabled
          : DEFAULT_PUBMED_SETTINGS.importantRunEnabled,
      importantRunIntervalDays: Number(
        stored.importantRunIntervalDays || DEFAULT_PUBMED_SETTINGS.importantRunIntervalDays
      ),
      importantLookbackMonths: Number(stored.importantLookbackMonths || DEFAULT_PUBMED_SETTINGS.importantLookbackMonths),
      importantRetmax: Math.min(
        Math.max(Number(stored.importantRetmax) || DEFAULT_PUBMED_SETTINGS.importantRetmax, 1),
        10
      ),
      retmax: Math.min(Math.max(Number(stored.retmax) || DEFAULT_PUBMED_SETTINGS.retmax, 1), 20)
    };
  } catch {
    return DEFAULT_PUBMED_SETTINGS;
  }
}

export function savePubMedSettings(settings: PubMedSettings) {
  localStorage.setItem(
    PUBMED_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      ...settings,
      apiKey: "",
      dailyRunTime: /^\d{2}:\d{2}$/.test(settings.dailyRunTime)
        ? settings.dailyRunTime
        : DEFAULT_PUBMED_SETTINGS.dailyRunTime,
      retmax: Math.min(Math.max(Number(settings.retmax) || DEFAULT_PUBMED_SETTINGS.retmax, 1), 20),
      importantRunIntervalDays: Math.min(
        Math.max(Number(settings.importantRunIntervalDays) || DEFAULT_PUBMED_SETTINGS.importantRunIntervalDays, 1),
        31
      ),
      importantLookbackMonths: Math.min(
        Math.max(Number(settings.importantLookbackMonths) || DEFAULT_PUBMED_SETTINGS.importantLookbackMonths, 1),
        36
      ),
      importantRetmax: Math.min(
        Math.max(Number(settings.importantRetmax) || DEFAULT_PUBMED_SETTINGS.importantRetmax, 1),
        10
      )
    })
  );
}

export function loadPubMedCache(): PubMedCachePayload {
  if (typeof localStorage === "undefined") return clonePubMedCache(GENERATED_PUBMED_CACHE);
  try {
    const rawCache = localStorage.getItem(PUBMED_CACHE_STORAGE_KEY);
    const stored = rawCache ? (JSON.parse(rawCache) as Partial<PubMedCachePayload>) : undefined;
    return mergeWithGeneratedPubMedCache(stored);
  } catch {
    return clonePubMedCache(GENERATED_PUBMED_CACHE);
  }
}

export function savePubMedCache(cache: PubMedCachePayload) {
  localStorage.setItem(PUBMED_CACHE_STORAGE_KEY, JSON.stringify(cache));
  window.dispatchEvent(new Event(PUBMED_CACHE_EVENT));
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function localTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function pubMedDate(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("/");
}

function monthsAgo(months: number, now: Date) {
  const value = new Date(now);
  value.setMonth(value.getMonth() - months);
  return value;
}

function buildImportantQuery(settings: PubMedSettings, now = new Date()) {
  const months = Math.min(Math.max(Number(settings.importantLookbackMonths) || 24, 1), 36);
  const from = pubMedDate(monthsAgo(months, now));
  const to = pubMedDate(now);
  const combined = PUBMED_ALERTS.map((alert) => `(${alert.query})`).join(" OR ");
  return `( ${combined} ) AND ("${from}"[dp] : "${to}"[dp])`;
}

export function isPubMedAiReady(settings: PubMedSettings) {
  return settings.aiEndpointMode === "chat" || Boolean(settings.apiKey.trim());
}

export function isPubMedDailyRunDue(settings: PubMedSettings, cache: PubMedCachePayload, now = new Date()) {
  if (!settings.dailyRunEnabled) return false;
  if (localTimeValue(now) < settings.dailyRunTime) return false;
  return cache.lastAutoRunDate !== localDateKey(now);
}

export function isPubMedImportantRunDue(settings: PubMedSettings, cache: PubMedCachePayload, now = new Date()) {
  if (!settings.importantRunEnabled) return false;
  if (localTimeValue(now) < settings.dailyRunTime) return false;
  if (!cache.lastImportantRunAt) return true;
  const intervalDays = Math.min(Math.max(Number(settings.importantRunIntervalDays) || 7, 1), 31);
  const lastTime = Date.parse(cache.lastImportantRunAt);
  if (!Number.isFinite(lastTime)) return true;
  return now.getTime() - lastTime >= intervalDays * 24 * 60 * 60 * 1000;
}

export async function fetchImportantPubMedArticles(settings: PubMedSettings, now = new Date()) {
  const query = buildImportantQuery(settings, now);
  const ids = await searchPubMedIds(query, settings, {
    retmax: Math.min(Math.max(settings.importantRetmax, 1), 10),
    sort: "relevance"
  });
  return fetchPubMedArticlesByIds(ids, settings);
}

function responsesEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/responses`;
  return `${trimmed}/v1/responses`;
}

function chatCompletionsEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function buildSummaryInput(alert: PubMedAlertDefinition, articles: PubMedArticle[]) {
  const articleBlocks = articles
    .slice(0, 5)
    .map((article, index) =>
      [
        `#${index + 1}`,
        `PMID: ${article.pmid}`,
        `Title: ${article.title}`,
        `Journal: ${article.journal || "unknown"} (${article.publicationDate || "date unknown"})`,
        `Authors: ${article.authors.join(", ") || "unknown"}`,
        `Abstract: ${truncate(article.abstract || "No abstract available.", 900)}`
      ].join("\n")
    )
    .join("\n\n");

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
    articleBlocks
  ].join("\n");
}

function buildImportantSummaryInput(settings: PubMedSettings, articles: PubMedArticle[]) {
  const articleBlocks = articles
    .slice(0, 5)
    .map((article, index) =>
      [
        `#${index + 1}`,
        `PMID: ${article.pmid}`,
        `Title: ${article.title}`,
        `Journal: ${article.journal || "unknown"} (${article.publicationDate || "date unknown"})`,
        `Authors: ${article.authors.join(", ") || "unknown"}`,
        `Abstract: ${truncate(article.abstract || "No abstract available.", 900)}`
      ].join("\n")
    )
    .join("\n\n");

  return [
    `Scope: Important pediatric critical care / pediatric cardiac intensive care papers from the last ${settings.importantLookbackMonths} months.`,
    "Audience: pediatric intensivists and pediatric cardiac intensivists.",
    "Task: Select and summarize the most important papers from the provided PubMed records in Japanese.",
    "",
    "Rank by likely clinical relevance, practice-changing potential, methodological strength, journal/context, and relevance to PICU/CICU.",
    "Do not treat every paper as equally important. It is acceptable to say that some records look low priority.",
    "",
    "Output format:",
    "1. 今回の最重要論文: top 3-5 papers, each with PMID, one-line finding, why it matters, and caveat",
    "2. テーマ別まとめ: respiratory, sepsis/shock, ECMO/ECLS, AKI/CRRT, sedation/delirium, congenital heart/CICU as applicable",
    "3. すぐ読むべき順",
    "4. 後回しでよいもの / 抄録だけでは判断困難なもの",
    "",
    "If only abstracts are available, explicitly say so and avoid overstating causality.",
    "",
    articleBlocks
  ].join("\n");
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (response.output_text) return response.output_text;
  const chatText = response.choices?.[0]?.message?.content;
  if (chatText) return chatText;
  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

async function requestAiText(settings: PubMedSettings, input: string, systemPrompt: string) {
  const isChatMode = settings.aiEndpointMode === "chat";
  if (!isChatMode && !settings.apiKey.trim()) throw new Error("AI要約にはAPIキーが必要です。");
  const body = isChatMode
    ? {
        model: settings.aiModel.trim() || DEFAULT_PUBMED_SETTINGS.aiModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input }
        ]
      }
    : {
        model: settings.aiModel.trim() || DEFAULT_PUBMED_SETTINGS.aiModel,
        reasoning: { effort: "low" },
        instructions: systemPrompt,
        input
      };

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;

  const response = await fetch(isChatMode ? chatCompletionsEndpoint(settings.aiBaseUrl) : responsesEndpoint(settings.aiBaseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? ((payload as { error?: { message?: string } }).error?.message ?? "")
        : "";
    throw new Error(message || `AI要約に失敗しました (${response.status})。`);
  }

  const output = extractOutputText(payload);
  if (!output) throw new Error("AI要約の応答本文を読み取れませんでした。");
  return output;
}

export async function summarizePubMedArticles(
  alert: PubMedAlertDefinition,
  articles: PubMedArticle[],
  settings: PubMedSettings
) {
  if (articles.length === 0) throw new Error("要約する論文がありません。");
  return requestAiText(
    settings,
    buildSummaryInput(alert, articles),
    "You are a careful medical literature summarizer. Write concise Japanese for clinicians. Do not provide individual medical advice."
  );
}

export async function summarizeImportantPubMedArticles(articles: PubMedArticle[], settings: PubMedSettings) {
  if (articles.length === 0) throw new Error("要約する重要論文候補がありません。");
  return requestAiText(
    settings,
    buildImportantSummaryInput(settings, articles),
    "You are a careful medical literature curator for pediatric intensive care and pediatric cardiac intensive care. Write concise Japanese for clinicians, rank priorities, and avoid overstatement."
  );
}

export async function runPubMedDailyUpdate(
  settings: PubMedSettings,
  cache: PubMedCachePayload = loadPubMedCache(),
  now = new Date()
): Promise<PubMedCachePayload> {
  const nextCache: PubMedCachePayload = {
    articlesByAlert: { ...cache.articlesByAlert },
    summaryByAlert: { ...cache.summaryByAlert },
    fetchedAtByAlert: { ...cache.fetchedAtByAlert },
    importantArticles: [...cache.importantArticles],
    importantSummary: cache.importantSummary,
    importantFetchedAt: cache.importantFetchedAt,
    lastAutoRunAt: now.toISOString(),
    lastAutoRunDate: localDateKey(now),
    lastAutoRunStatus: "更新中",
    lastImportantRunAt: cache.lastImportantRunAt,
    lastImportantRunStatus: cache.lastImportantRunStatus
  };

  const statusMessages: string[] = [];

  for (const alert of PUBMED_ALERTS) {
    try {
      const articles = await fetchPubMedArticles(alert, settings);
      nextCache.articlesByAlert[alert.key] = articles;
      nextCache.fetchedAtByAlert[alert.key] = new Date().toISOString();
      statusMessages.push(`${alert.title}: ${articles.length}件取得`);

      if (settings.dailyRunSummaries && isPubMedAiReady(settings) && articles.length > 0) {
        try {
          nextCache.summaryByAlert[alert.key] = await summarizePubMedArticles(alert, articles, settings);
          statusMessages.push(`${alert.title}: AI要約済み`);
        } catch (error) {
          statusMessages.push(`${alert.title}: AI要約失敗 (${(error as Error).message})`);
        }
      }
    } catch (error) {
      statusMessages.push(`${alert.title}: 取得失敗 (${(error as Error).message})`);
    }
  }

  nextCache.lastAutoRunStatus = statusMessages.join(" / ");
  savePubMedCache(nextCache);
  return nextCache;
}

export async function runPubMedImportantUpdate(
  settings: PubMedSettings,
  cache: PubMedCachePayload = loadPubMedCache(),
  now = new Date()
): Promise<PubMedCachePayload> {
  const nextCache: PubMedCachePayload = {
    articlesByAlert: { ...cache.articlesByAlert },
    summaryByAlert: { ...cache.summaryByAlert },
    fetchedAtByAlert: { ...cache.fetchedAtByAlert },
    importantArticles: [...cache.importantArticles],
    importantSummary: cache.importantSummary,
    importantFetchedAt: cache.importantFetchedAt,
    lastAutoRunAt: cache.lastAutoRunAt,
    lastAutoRunDate: cache.lastAutoRunDate,
    lastAutoRunStatus: cache.lastAutoRunStatus,
    lastImportantRunAt: now.toISOString(),
    lastImportantRunStatus: "更新中"
  };

  try {
    const articles = await fetchImportantPubMedArticles(settings, now);
    nextCache.importantArticles = articles;
    nextCache.importantFetchedAt = new Date().toISOString();
    nextCache.lastImportantRunStatus = `重要論文候補 ${articles.length}件取得`;

    if (isPubMedAiReady(settings) && articles.length > 0) {
      try {
        nextCache.importantSummary = await summarizeImportantPubMedArticles(articles, settings);
        nextCache.lastImportantRunStatus += " / AI要約済み";
      } catch (error) {
        nextCache.lastImportantRunStatus += ` / AI要約失敗 (${(error as Error).message})`;
      }
    }
  } catch (error) {
    nextCache.lastImportantRunStatus = `重要論文取得失敗 (${(error as Error).message})`;
  }

  savePubMedCache(nextCache);
  return nextCache;
}
