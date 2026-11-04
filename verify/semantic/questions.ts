// #126 評測題（verify 分支專用，不合併）。只用參考情境既有的虛構名稱，沒有新名稱。
// 跨語言題以 RetrieveOptions.language 只取另一種語言的段落：等同「這個事實只有該語言的段落」，不必另建客戶資料夾。
// 同義詞題只取與問題同語言的段落，避免靠另一種語言的段落命中。
import evals from "../../client/evals/questions.json";

export type Kind = "existing" | "cross-zh-en" | "cross-en-zh" | "synonym" | "near-refusal";

export interface VerifyQuestion {
  id: string;
  kind: Kind;
  role: string;
  language: "zh-TW" | "en";
  text: string;
  expect: "answer" | "refusal";
  answers: string[];
  // 只取這個語言的段落；未指定時取全部
  only?: "zh-TW" | "en";
}

const existing: VerifyQuestion[] = evals.questions.map((q) => ({
  id: q.id,
  kind: "existing",
  role: q.role,
  language: q.language as "zh-TW" | "en",
  text: q.question,
  expect: q.expect as "answer" | "refusal",
  answers: q.answerPassages,
}));

const a = (id: string, kind: Kind, role: string, language: "zh-TW" | "en", text: string, answers: string[], only?: "zh-TW" | "en"): VerifyQuestion => ({
  id, kind, role, language, text, expect: answers.length > 0 ? "answer" : "refusal", answers, only,
});

export const QUESTIONS: VerifyQuestion[] = [
  ...existing,
  // 中文問題、只有英文段落
  a("x-office-hours", "cross-zh-en", "guest", "zh-TW", "上班時間是幾點到幾點？", ["employee-handbook-en-02"], "en"),
  a("x-annual-leave", "cross-zh-en", "staff", "zh-TW", "到職滿一年有幾天年假？", ["employee-handbook-en-03"], "en"),
  a("x-people-manager", "cross-zh-en", "guest", "zh-TW", "人資部的經理是誰？", ["employee-handbook-en-04"], "en"),
  a("x-desk-height", "cross-zh-en", "staff", "zh-TW", "青翼桌的高度可以調整到多少？", ["bluewing-spec-en-01"], "en"),
  a("x-panel-designer", "cross-zh-en", "staff", "zh-TW", "青翼桌的控制面板是誰設計的？", ["bluewing-spec-en-03"], "en"),
  a("x-desk-load", "cross-zh-en", "staff", "zh-TW", "青翼桌最多可以承重多少？", ["bluewing-spec-en-02"], "en"),
  a("x-raise", "cross-zh-en", "manager", "zh-TW", "2026 年平均調薪多少？", ["compensation-2026-en-01"], "en"),
  a("x-vendor", "cross-zh-en", "manager", "zh-TW", "長堤專案推薦哪一家倉儲系統廠商？", ["longpier-vendor-en-02"], "en"),
  a("x-sales-feedback", "cross-zh-en", "staff", "zh-TW", "業務部在青翼桌上市前要收集什麼？", ["sales-weekly-en-01"], "en"),
  // 英文問題、只有中文段落
  a("y-material-cost", "cross-en-zh", "manager", "en", "What is the material cost of the Bluewing desk?", ["bluewing-cost-zh-01"], "zh-TW"),
  a("y-budget", "cross-en-zh", "manager", "en", "What is the budget for Project Bluewing?", ["bluewing-kickoff-zh-03"], "zh-TW"),
  a("y-suspicious-email", "cross-en-zh", "staff", "en", "What should I do if I receive a suspicious email?", ["info-security-zh-03"], "zh-TW"),
  a("y-disk-encryption", "cross-en-zh", "staff", "en", "Do company laptops need disk encryption?", ["info-security-zh-01"], "zh-TW"),
  a("y-warehouse-supervisor", "cross-en-zh", "staff", "en", "Who is the warehouse supervisor in Operations?", ["org-chart-zh-02"], "zh-TW"),
  a("y-warehouse-team", "cross-en-zh", "manager", "en", "When will the warehouse team be set up?", ["reorg-2026-zh-01"], "zh-TW"),
  a("y-barcode-test", "cross-en-zh", "manager", "en", "Has the barcode scanning test for Project Longpier been completed?", ["longpier-progress-zh-02"], "zh-TW"),
  a("y-over-budget", "cross-en-zh", "manager", "en", "How much is Project Longpier over budget?", ["longpier-progress-zh-03"], "zh-TW"),
  a("y-retail-price", "cross-en-zh", "manager", "en", "What is the suggested retail price of the Bluewing desk?", ["bluewing-cost-zh-02"], "zh-TW"),
  a("y-user-testing", "cross-en-zh", "staff", "en", "When is the user testing of the control panel?", ["bluewing-status-zh-02"], "zh-TW"),
  // 同義詞：問題用段落裡沒有的說法
  a("s-hiring-zh", "synonym", "guest", "zh-TW", "誰負責招聘新人？", ["employee-handbook-zh-04"], "zh-TW"),
  a("s-day-off-zh", "synonym", "staff", "zh-TW", "工作一年後可以休假幾天？", ["employee-handbook-zh-03"], "zh-TW"),
  a("s-computer-zh", "synonym", "staff", "zh-TW", "電腦不用的時候要怎麼保護？", ["info-security-zh-01"], "zh-TW"),
  a("s-vacation-en", "synonym", "staff", "en", "How many vacation days do I get after a year?", ["employee-handbook-en-03"], "en"),
  a("s-hiring-en", "synonym", "guest", "en", "Who is in charge of hiring?", ["employee-handbook-en-04"], "en"),
  a("s-pay-increase-en", "synonym", "manager", "en", "How big is this year's pay increase?", ["compensation-2026-en-01"], "en"),
  // 主題相近但資料集沒有答案
  a("r-parking-zh", "near-refusal", "staff", "zh-TW", "員工的停車位怎麼申請？", []),
  a("r-warranty-zh", "near-refusal", "staff", "zh-TW", "青翼桌的保固期是多久？", []),
  a("r-golive-zh", "near-refusal", "manager", "zh-TW", "長堤專案的上線日期是哪一天？", []),
  a("r-parental-en", "near-refusal", "staff", "en", "What is the parental leave policy?", []),
  a("r-sales-headcount-en", "near-refusal", "manager", "en", "How many people work in the Sales team?", []),
];
