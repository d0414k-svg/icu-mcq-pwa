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
      "日本集中治療医学会の重症患者栄養療法ガイドライン2024の英語版。成人と小児を含むICU患者を対象に、早期経腸栄養、栄養評価、投与経路、蛋白・エネルギー目標、特殊病態での栄養管理をGRADEに基づいて整理している。",
    whyItMatters:
      "PICUでは経腸栄養をいつ始めるか、蛋白・エネルギーをどこまで狙うか、循環不安定時にどう進めるかが日々の判断になる。日本の診療環境に近い推奨として、病棟プロトコル更新や多職種カンファの土台に使いやすい。",
    caveat:
      "小児領域は成人よりエビデンスが薄く、弱い推奨やGood Practice Statementが多い。施設の製剤、消化管リスク、循環動態、NST体制に合わせてローカル適応が必要。"
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
      "SRLF/GFRUPによる成人・小児ICUの栄養サポート指針。複数のPICOから成人34、小児29の推奨を作成し、近年のRCTや専門家合意を踏まえて個別化した栄養戦略を示している。",
    whyItMatters:
      "日本版ガイドラインと照らし合わせることで、PICU栄養管理の国際的な共通点と差分を確認できる。経腸栄養開始、静脈栄養の位置づけ、モニタリング項目を見直すときの比較対象になる。",
    caveat:
      "小児推奨の多くは専門家意見または中等度以下のエビデンス。日本の診療体制、製剤、栄養士・NST運用にそのまま当てはめず、施設ごとの実装設計が必要。"
  },
  {
    pmid: "40439782",
    title: "Guidelines for the management of emergencies and critical illness in pediatric and adult patients with sickle cell disease.",
    journal: "Ann Intensive Care",
    published: "2025 May 29",
    url: "https://pubmed.ncbi.nlm.nih.gov/40439782/",
    tags: ["鎌状赤血球症", "急性胸部症候群", "救急ICU"],
    summary:
      "鎌状赤血球症の救急・重症管理に関する成人・小児向けガイドライン。ICU入室判断、専門施設との連携、血管閉塞発作、急性胸部症候群、輸血療法、疼痛、酸素化、抗菌薬などを整理している。",
    whyItMatters:
      "日本では頻度が高くない疾患だが、急性胸部症候群や輸血関連合併症ではPICU初動が重要。希少疾患の当直対応、搬送判断、専門施設への相談タイミングを確認する資料として役立つ。",
    caveat:
      "推奨には低エビデンスまたは専門家意見が多い。地域の血液内科、輸血部、小児専門施設との連携プロトコルが前提になる。"
  },
  {
    pmid: "40668437",
    title: "Renal replacement therapy in an intensive care unit: guidelines from the SRLF-GFRUP consensus conference.",
    journal: "Ann Intensive Care",
    published: "2025 Jul 16",
    url: "https://pubmed.ncbi.nlm.nih.gov/40668437/",
    tags: ["AKI", "CRRT", "腎代替療法"],
    summary:
      "ICUでの急性腎障害に対する腎代替療法について、開始判断、モダリティ選択、投与量、抗凝固、モニタリング、血管アクセス、回路トラブル予防を成人・小児の観点で整理したコンセンサス文書。",
    whyItMatters:
      "PICUでCRRTを始めるタイミング、血管アクセス、抗凝固、回路管理は施設差が出やすい。チェックリストや標準手順を見直す入口になる。",
    caveat:
      "コンセンサス文書であり、患者背景、循環動態、体格、出血リスク、使用可能な機器に応じた調整が必要。"
  }
];
