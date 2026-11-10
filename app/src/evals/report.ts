// 給客戶的品質報告（#210，docs/evals.md「品質報告」）的內容：純函式，輸入是下載 JSON（evalReport()）的內容，可選另一次的下載 JSON 顯示穩定性。
// 機密（#210 決定 3 與補充）：報告會被帶出系統，只放題目序號、類別、身分、數字與判定；不放題目 id、題目文字、回答、段落、keyPoints、forbidden、referenceAnswer 與滲漏的 term。
// 題目 id 是描述性名稱，可能透露題目內容，所以改用題目在 questions.json 的序號（從 1 開始；只對同一個題庫雜湊有效）。
// 可見等級最高的身分在附錄只呈現各類別的彙總，不列題目序號。
import type { AccessFile, EvalThresholds } from "../client/types";
import type { Dataset } from "../dataset/load";
import type { EvalSettings, QuestionResult } from "./run";
import { answerCorrect, LEAKAGE_LIMIT, type AnswerMode, type Metric, type Summary } from "./score";
import type { EvalCategory, EvalQuestion } from "./types";

// 題庫版本：questions.json 內容的 SHA-256 前 12 碼（#210 決定 2）；與 `shasum -a 256 questions.json` 的開頭相同
export const HASH_LENGTH = 12;

export interface QuestionBank {
  // 無法計算（非安全連線的瀏覽器沒有 crypto.subtle）時為 null
  hash: string | null;
  questions: number;
}

export async function questionBank(source: string, questions: number): Promise<QuestionBank> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return { hash: null, questions };
  const digest = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(source)));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { hash: hex.slice(0, HASH_LENGTH), questions };
}

// 下載 JSON 中報告用到的欄位；questionBank、model 與每題的 calls 在舊格式中沒有
export interface ReportSource {
  mode: AnswerMode;
  provider: string;
  notApplicable: string[];
  status: string;
  startedAt: string;
  finishedAt: string | null;
  model?: string;
  questionBank?: QuestionBank;
  sets: { settings: EvalSettings; summary: Summary; results: QuestionResult[] }[];
}

export const METRIC_KEYS = ["citation", "answer", "leakage", "refusal"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface MetricResult {
  passed: number;
  total: number;
  rate: number | null;
  // 分母為 0 或沒有跑完時為 null（不判定）
  meets: boolean | null;
}

export interface MetricRow extends MetricResult {
  key: MetricKey;
  // 權限滲漏是題數上限（LEAKAGE_LIMIT），其他是比例
  threshold: number;
  // 第二次的結果；沒有第二次時為 null
  second: MetricResult | null;
  // 兩次都達到；不能比較（題庫不同或第二次沒跑完）或任一次不判定時為 null
  bothMeet: boolean | null;
}

// 第二次不能比較或需要註明的原因
export type StabilityNote = "bankDiffers" | "bankUnknown" | "incomplete" | "settingsDiffer";

export interface Stability {
  comparable: boolean;
  notes: StabilityNote[];
  settings: EvalSettings;
  startedAt: string;
  // 兩次結果不同的題數；不能比較時為 null
  differing: number | null;
}

export interface QualityReport {
  headline: {
    questions: number;
    leaked: number;
    // 這次未達門檻的指標
    unmet: MetricKey[];
    // 兩次都達到所有門檻，或第二次有指標未達；不能比較時為 null
    second: "bothMet" | "secondUnmet" | null;
  };
  metrics: MetricRow[];
  stability: Stability | null;
  // 每種身分的題數與有滲漏的題數，依 access.json 的順序
  roles: { role: string; questions: number; leaked: number; restricted: boolean }[];
  categories: EvalCategory[];
  // 身分 × 類別：通過數／題數（任一指標未通過或有滲漏就不算通過）
  matrix: { role: string; category: EvalCategory; passed: number; total: number }[];
  // 未通過的題目，以題目在 questions.json 的序號（從 1 開始）代替 id；可見等級最高的身分不列出
  failures: { number: number; role: string; category: EvalCategory; failed: MetricKey[] }[];
  // 可見等級最高的身分中未通過的題數（只在 matrix 呈現彙總）
  restrictedFailures: number;
  coverage: Coverage;
  conditions: {
    bank: QuestionBank | null;
    settings: EvalSettings;
    provider: string;
    notApplicable: number;
    mode: AnswerMode;
    model: string | null;
    startedAt: string;
    finishedAt: string | null;
    // 送出的問答與模型評分的次數；舊格式沒有記錄時為 null
    calls: number | null;
  };
}

export interface Coverage {
  // 答案段落涵蓋的文件數／資料集的文件數（評測用的是資料集，不含上傳的文件；#210 決定 5）
  covered: number;
  total: number;
  // 依可見等級（rank 由低到高）
  levels: { level: string; covered: number; total: number }[];
}

export function coverage(questions: EvalQuestion[], data: Dataset, access: AccessFile): Coverage {
  const documents = Object.values(data.documents);
  const docOf = new Map(documents.flatMap((d) => d.passages.map((p) => [p.id, d.id] as const)));
  const covered = new Set(questions.flatMap((q) => q.answerPassages.flatMap((id) => docOf.get(id) ?? [])));
  const levels = [...access.visibilityLevels]
    .sort((a, b) => a.rank - b.rank)
    .map((l) => {
      const docs = documents.filter((d) => d.visibility === l.id);
      return { level: l.id, covered: docs.filter((d) => covered.has(d.id)).length, total: docs.length };
    });
  return { covered: covered.size, total: documents.length, levels };
}

// 可見等級是最高等級（rank 最大）的身分：附錄只呈現彙總
export function restrictedRoles(access: AccessFile): Set<string> {
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  const top = Math.max(...access.visibilityLevels.map((l) => l.rank));
  return new Set(access.roles.filter((r) => rank.get(r.visibility) === top).map((r) => r.id));
}

// 一題沒有通過的指標（不適用的指標不列）
export function failedMetrics(result: QuestionResult, mode: AnswerMode): MetricKey[] {
  const { score } = result;
  const failed: MetricKey[] = [];
  if (score.citation !== null && !score.citation.pass) failed.push("citation");
  if (score.keyPoints !== null && !answerCorrect(score, mode, result.grade)) failed.push("answer");
  if (score.leaks.length > 0) failed.push("leakage");
  if (score.refused === false) failed.push("refusal");
  return failed;
}

// 依目前的門檻重新判定（第二份 JSON 的 meets 是當時的門檻）
function judge(key: MetricKey, m: Metric, complete: boolean, thresholds: EvalThresholds): MetricResult {
  const threshold = key === "leakage" ? LEAKAGE_LIMIT : thresholds[key];
  const meets = !complete || m.rate === null ? null : key === "leakage" ? m.passed <= threshold : m.rate >= threshold - 1e-9;
  return { passed: m.passed, total: m.total, rate: m.rate, meets };
}

const sameSettings = (a: EvalSettings, b: EvalSettings) => a.topK === b.topK && a.minScore === b.minScore;

function callsOf(results: QuestionResult[]): number | null {
  let total = 0;
  for (const r of results) {
    if (r.calls === undefined) return null;
    total += r.calls;
  }
  return total;
}

export interface ReportInput {
  // 目前的題庫（整份）
  questions: EvalQuestion[];
  access: AccessFile;
  data: Dataset;
  thresholds: EvalThresholds;
  current: ReportSource;
  // 要報告的設定組（目前的評測有兩組設定時）
  set: number;
  // 另一次的下載 JSON：優先用設定相同的那一組，找不到時用第一組
  previous?: ReportSource | null;
}

export function qualityReport(input: ReportInput): QualityReport {
  const { questions, access, thresholds, current } = input;
  // 下載 JSON 記下的實際 provider（降級時是 keyword-hash），不是 client.json 的設定
  const { provider } = current;
  const set = current.sets[input.set];
  const complete = set.summary.complete && current.status === "done";
  const byId = new Map(questions.map((q) => [q.id, q]));
  const numberOf = new Map(questions.map((q, i) => [q.id, i + 1]));
  const results = set.results.filter((r) => byId.has(r.question));
  const restricted = restrictedRoles(access);

  const prev = input.previous ?? null;
  const prevSet = prev === null ? null : (prev.sets.find((s) => sameSettings(s.settings, set.settings)) ?? prev.sets[0] ?? null);
  let stability: Stability | null = null;
  if (prev !== null && prevSet !== null) {
    const notes: StabilityNote[] = [];
    const [a, b] = [current.questionBank?.hash ?? null, prev.questionBank?.hash ?? null];
    if (a === null || b === null) notes.push("bankUnknown");
    else if (a !== b) notes.push("bankDiffers");
    if (!(prevSet.summary.complete && prev.status === "done")) notes.push("incomplete");
    if (!sameSettings(prevSet.settings, set.settings)) notes.push("settingsDiffer");
    const comparable = complete && !notes.some((n) => n !== "settingsDiffer");
    const prevById = new Map(prevSet.results.map((r) => [r.question, r]));
    const differing = results.filter((r) => {
      const other = prevById.get(r.question);
      return other !== undefined && failedMetrics(r, current.mode).join() !== failedMetrics(other, prev.mode).join();
    }).length;
    stability = { comparable, notes, settings: prevSet.settings, startedAt: prev.startedAt, differing: comparable ? differing : null };
  }

  const metrics: MetricRow[] = METRIC_KEYS.map((key) => {
    const first = judge(key, set.summary[key], complete, thresholds);
    const second = prevSet === null ? null : judge(key, prevSet.summary[key], true, thresholds);
    const comparable = stability?.comparable ?? false;
    const bothMeet = !comparable || second === null || first.meets === null || second.meets === null ? null : first.meets && second.meets;
    return { key, ...first, threshold: key === "leakage" ? LEAKAGE_LIMIT : thresholds[key], second: comparable ? second : null, bothMeet };
  });

  const rows = results.map((r) => ({ q: byId.get(r.question)!, failed: failedMetrics(r, current.mode) }));
  const categories = [...new Set(rows.map((r) => r.q.category))];
  const roleIds = access.roles.map((r) => r.id).filter((id) => rows.some((r) => r.q.role === id));
  const failing = rows.filter((r) => r.failed.length > 0);

  let second: QualityReport["headline"]["second"] = null;
  if (stability?.comparable) {
    if (metrics.some((m) => m.second?.meets === false)) second = "secondUnmet";
    else if (metrics.every((m) => m.bothMeet !== false) && metrics.some((m) => m.bothMeet === true)) second = "bothMet";
  }

  return {
    headline: {
      questions: results.length,
      leaked: rows.filter((r) => r.failed.includes("leakage")).length,
      unmet: metrics.filter((m) => m.meets === false).map((m) => m.key),
      second,
    },
    metrics,
    stability,
    roles: roleIds.map((role) => {
      const mine = rows.filter((r) => r.q.role === role);
      return { role, questions: mine.length, leaked: mine.filter((r) => r.failed.includes("leakage")).length, restricted: restricted.has(role) };
    }),
    categories,
    matrix: roleIds.flatMap((role) =>
      categories.flatMap((category) => {
        const cell = rows.filter((r) => r.q.role === role && r.q.category === category);
        return cell.length === 0 ? [] : [{ role, category, passed: cell.filter((r) => r.failed.length === 0).length, total: cell.length }];
      }),
    ),
    failures: failing.filter((r) => !restricted.has(r.q.role)).map((r) => ({ number: numberOf.get(r.q.id)!, role: r.q.role, category: r.q.category, failed: r.failed })),
    restrictedFailures: failing.filter((r) => restricted.has(r.q.role)).length,
    coverage: coverage(questions, input.data, access),
    conditions: {
      bank: current.questionBank ?? null,
      settings: set.settings,
      provider,
      notApplicable: current.notApplicable.length,
      mode: current.mode,
      model: current.model ?? null,
      startedAt: current.startedAt,
      finishedAt: current.finishedAt,
      calls: callsOf(set.results),
    },
  };
}
