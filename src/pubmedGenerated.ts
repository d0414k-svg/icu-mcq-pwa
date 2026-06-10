import type { PubMedCachePayload } from "./pubmed";

export const GENERATED_PUBMED_CACHE_VERSION = "initial";

export const GENERATED_PUBMED_CACHE: PubMedCachePayload = {
  articlesByAlert: {
    focused: [],
    broad: []
  },
  summaryByAlert: {},
  fetchedAtByAlert: {},
  importantArticles: [],
  importantSummary: undefined,
  importantFetchedAt: undefined,
  lastAutoRunAt: undefined,
  lastAutoRunDate: undefined,
  lastAutoRunStatus: "自動PubMed要約はGitHub Actionsで生成されます。",
  lastImportantRunAt: undefined,
  lastImportantRunStatus: undefined
};
