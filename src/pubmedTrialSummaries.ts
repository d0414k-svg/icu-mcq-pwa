export interface PubMedTrialSummary {
  pmid: string;
  title: string;
  journal: string;
  published: string;
  url: string;
  tags: string[];
  summary: string;
  whyItMatters: string;
  caveat: string;
}

export const PUBMED_TRIAL_SUMMARIES: PubMedTrialSummary[] = [
  {
    pmid: "40119480",
    title: "The Japanese Critical Care Nutrition Guideline 2024.",
    journal: "J Intensive Care",
    published: "2025 Mar 21",
    url: "https://pubmed.ncbi.nlm.nih.gov/40119480/",
    tags: ["栄養", "ガイドライン", "小児ICU"],
    summary:
      "日本集中治療医学会の重症患者栄養療法ガイドライン2024英語版。成人と小児を含むICU患者を対象に、早期経腸栄養、栄養評価、投与経路、蛋白/エネルギー、特殊病態での栄養管理をGRADEに基づいて整理している。",
    whyItMatters:
      "小児では早期経腸栄養、ボーラス投与、エネルギー/蛋白密度の高い製剤などが弱い推奨として示され、PICUでの日々の栄養開始タイミングや処方見直しの土台になる。",
    caveat:
      "小児領域は成人よりエビデンスが薄く、弱い推奨やGood Practice Statementが多い。施設プロトコルへ落とす時は対象年齢、循環動態、消化管リスクを別途確認したい。"
  },
  {
    pmid: "40665004",
    title:
      "Expert consensus-based clinical practice guidelines for nutritional support in the intensive care unit: the French Intensive Care Society (SRLF) and the French-Speaking Group of Pediatric Emergency Physicians and Intensivists (GFRUP).",
    journal: "Ann Intensive Care",
    published: "2025 Jul 15",
    url: "https://pubmed.ncbi.nlm.nih.gov/40665004/",
    tags: ["栄養", "コンセンサス", "PICU"],
    summary:
      "SRLF/GFRUPによる成人・小児ICUの栄養サポート指針。24のPICOから成人34、小児29の推奨を作成し、近年のRCTを踏まえて個別化栄養戦略を提示している。",
    whyItMatters:
      "日本版ガイドラインと照らし合わせることで、PICU栄養の国際的な共通点と差分を確認できる。栄養プロトコル更新時の比較対象として有用。",
    caveat:
      "小児推奨の多くは専門家意見または中等度以下のエビデンス。日本の診療体制・製剤・NST運用にそのまま当てはめず、ローカル適応が必要。"
  },
  {
    pmid: "40439782",
    title: "Guidelines for the management of emergencies and critical illness in pediatric and adult patients with sickle cell disease.",
    journal: "Ann Intensive Care",
    published: "2025 May 29",
    url: "https://pubmed.ncbi.nlm.nih.gov/40439782/",
    tags: ["鎌状赤血球症", "急性胸部症候群", "救急/ICU"],
    summary:
      "鎌状赤血球症の救急・重症管理に関する成人/小児向けガイドライン。ICU入室判断、専門施設連携、血管閉塞発作、急性胸部症候群、輸血療法、疼痛、酸素化、抗菌薬などを扱う。",
    whyItMatters:
      "日本では頻度が高くない疾患だが、急性胸部症候群や輸血関連合併症はPICUで初動が重要。希少疾患の当直対応・搬送判断の参照資料として価値がある。",
    caveat:
      "推奨には低エビデンスまたは専門家意見が多い。地域の血液内科、輸血部、専門施設との連携プロトコルが前提になる。"
  },
  {
    pmid: "40668437",
    title: "Renal replacement therapy in an intensive care unit: guidelines from the SRLF-GFRUP consensus conference.",
    journal: "Ann Intensive Care",
    published: "2025 Jul 16",
    url: "https://pubmed.ncbi.nlm.nih.gov/40668437/",
    tags: ["AKI", "CRRT", "腎代替療法"],
    summary:
      "ICUにおける急性腎障害への腎代替療法について、開始適応、モダリティ選択、透析量、処方・モニタリング、血管アクセス、回路凝固予防、離脱基準を成人/小児の観点で整理したコンセンサス。",
    whyItMatters:
      "PICUでCRRTを開始するタイミング、アクセス、回路管理、離脱判断は施設差が大きい。チェックリストや標準処方を見直す入口になる。",
    caveat:
      "コンセンサス文書であり、個々の患児の循環動態、体格、抗凝固リスク、使用可能な機器に応じた調整が必須。"
  }
];
