import { describe, expect, it } from "vitest";
import type { AccessFile, ScenariosFile } from "../client/types";
import type { ReviewDocument, ReviewStatus } from "../extraction/store";
import {
  askedWhen,
  entityShape,
  greetingPeriod,
  MAX_ASKED,
  MAX_UPDATES,
  MAX_VIEWED,
  rememberQuestion,
  rememberViewed,
  reportUpdates,
  roleScenarios,
  UPLOAD_DOT,
  uploadUpdates,
  visibleScope,
  waitingRows,
  waitingSummary,
  type AskedQuestion,
} from "./home";
import type { AnswerReport } from "../reports/store";
import { pendingCount } from "./review-helpers";

describe("greetingPeriod", () => {
  it("早安 5–11 時、午安 12–17 時、晚安 18–4 時（邊界 5:00、12:00、18:00）", () => {
    const expected: Record<number, string> = { 0: "evening", 4: "evening", 5: "morning", 11: "morning", 12: "afternoon", 17: "afternoon", 18: "evening", 23: "evening" };
    for (const [hour, period] of Object.entries(expected)) expect(greetingPeriod(Number(hour))).toBe(period);
  });

  it("每個時都有問候", () => {
    const periods = Array.from({ length: 24 }, (_, h) => greetingPeriod(h));
    expect(periods.filter((p) => p === "morning")).toHaveLength(7);
    expect(periods.filter((p) => p === "afternoon")).toHaveLength(6);
    expect(periods.filter((p) => p === "evening")).toHaveLength(11);
  });
});

const item = (id: string, status: ReviewStatus) => ({ id, type: "person", names: {}, sources: [], status, decisionId: null, mergedInto: null });
const doc = (id: string, statuses: ReviewStatus[]): ReviewDocument => ({
  id,
  title: id,
  language: "zh-TW",
  visibility: "internal",
  project: null,
  entities: statuses.map((s, i) => item(`${id}-${i}`, s)),
  relations: [],
});

describe("waitingSummary", () => {
  const docs = [doc("a", ["pending", "pending"]), doc("b", ["approved", "rejected"]), doc("c", ["pending", "approved"])];
  const conflicts = [{ decision: null }, { decision: "coexist" as const }, { decision: null }];
  const reports = [
    { resolution: null, reportedAt: "2026-11-10T09:00:00.000Z" },
    { resolution: "not_error" as const, reportedAt: "2026-11-01T09:00:00.000Z" },
    { resolution: null, reportedAt: "2026-11-08T09:00:00.000Z" },
  ];

  it("待審文件只算有待審項目的文件；說法不同與回報只算未處理的；最早一則是未處理的回報中最早的", () => {
    expect(waitingSummary(docs, conflicts, reports)).toEqual({
      documents: 2,
      conflicts: 2,
      reports: 2,
      earliestReport: "2026-11-08T09:00:00.000Z",
      total: 7,
    });
  });

  it("導覽列「待審」的數字與 pendingCount() 相同", () => {
    expect(waitingSummary(docs, conflicts, reports).total).toBe(pendingCount(docs, conflicts, reports));
    expect(waitingSummary([], [], []).total).toBe(pendingCount([], [], []));
  });

  it("沒有等著處理的事時都是 0", () => {
    expect(waitingSummary([doc("b", ["approved"])], [{ decision: "supersede" }], [])).toEqual({ documents: 0, conflicts: 0, reports: 0, earliestReport: null, total: 0 });
  });
});

describe("uploadUpdates", () => {
  const decided = (d: ReviewDocument, decisions: Record<string, { decisionId: string; mergedInto?: string }>): ReviewDocument => ({
    ...d,
    entities: d.entities.map((e) => ({ ...e, decisionId: decisions[e.id]?.decisionId ?? null, mergedInto: decisions[e.id]?.mergedInto ?? null })),
  });

  it("列出審核中、已核准、部分退回、已退回；還沒有萃取出項目的不列入（#284 決定 4）", () => {
    const docs = [doc("pending", ["pending", "approved"]), doc("empty", []), doc("ok", ["approved"]), doc("some", ["approved", "rejected"]), doc("none", ["rejected"])];
    expect(uploadUpdates(docs, new Set(), 10).map((u) => [u.documentId, u.status])).toEqual([
      ["pending", "in_review"],
      ["ok", "approved"],
      ["some", "partly_rejected"],
      ["none", "rejected"],
    ]);
  });

  it("還在萃取的文件是審核中", () => {
    expect(uploadUpdates([doc("a", ["approved"])], new Set(["a"]))[0].status).toBe("in_review");
  });

  it("已核准時打開第一個核准的實體：新建的是決定的 id，合併的是合併對象", () => {
    const created = decided(doc("a", ["rejected", "approved", "approved"]), { "a-0": { decisionId: "a-0" }, "a-1": { decisionId: "a-1~2" }, "a-2": { decisionId: "a-2" } });
    const merged = decided(doc("b", ["approved"]), { "b-0": { decisionId: "b-0", mergedInto: "wang-xiaoming" } });
    const ok = decided(doc("c", ["approved", "approved"]), { "c-0": { decisionId: "c-0~2" }, "c-1": { decisionId: "c-1" } });
    expect(uploadUpdates([merged, ok], new Set()).map((u) => u.entityId)).toEqual(["wang-xiaoming", "c-0~2"]);
    // 部分退回與審核中的動作是查看進度
    expect(uploadUpdates([created], new Set())[0]).toMatchObject({ status: "partly_rejected", entityId: null });
    expect(uploadUpdates([doc("d", ["pending"])], new Set())[0].entityId).toBeNull();
  });

  it(`依 readMyUploads() 的順序，最多 ${MAX_UPDATES} 則`, () => {
    const docs = Array.from({ length: MAX_UPDATES + 2 }, (_, i) => doc(`d${i}`, ["pending"]));
    expect(uploadUpdates(docs, new Set()).map((u) => u.documentId)).toEqual(docs.slice(0, MAX_UPDATES).map((d) => d.id));
    expect(uploadUpdates([], new Set())).toEqual([]);
  });
});

describe("rememberQuestion", () => {
  const at = "2026-11-13T09:00:00.000Z";
  const q = (question: string, when = at): AskedQuestion => ({ question, at: when });
  const questions = (asked: readonly AskedQuestion[]) => asked.map((x) => x.question);

  it("最新的在前，同一個問題只留最新的一次（時間換成這次）", () => {
    const later = "2026-11-13T10:00:00.000Z";
    expect(rememberQuestion([q("b"), q("a")], "a", later)).toEqual([q("a", later), q("b")]);
    expect(questions(rememberQuestion([q("b"), q("a")], "c", at))).toEqual(["c", "b", "a"]);
  });

  it("只存問題文字與提問時間：去掉前後空白，空白的問題不記", () => {
    expect(rememberQuestion([q("a")], "  b \n", at)).toEqual([q("b"), q("a")]);
    expect(rememberQuestion([q("a")], "   ", at)).toEqual([q("a")]);
    expect(Object.keys(rememberQuestion([], "a", at)[0]).sort()).toEqual(["at", "question"]);
  });

  it(`最多保留 ${MAX_ASKED} 筆`, () => {
    let asked: AskedQuestion[] = [];
    for (let i = 0; i < MAX_ASKED + 5; i++) asked = rememberQuestion(asked, `q${i}`, at);
    expect(asked).toHaveLength(MAX_ASKED);
    expect(asked[0].question).toBe(`q${MAX_ASKED + 4}`);
  });
});

describe("askedWhen", () => {
  // 本地時間：以日曆日計算，不是 24 小時
  const now = new Date(2026, 10, 13, 9, 0);
  const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString();

  it("今天、昨天、幾天前（一週內以天）", () => {
    expect(askedWhen(at(13, 8), now)).toEqual({ value: -0, unit: "day" });
    expect(askedWhen(at(12, 23), now)).toEqual({ value: -1, unit: "day" });
    expect(askedWhen(at(10), now)).toEqual({ value: -3, unit: "day" });
  });

  it("一週以上以週、一個月以上以月；未來的時間當作今天", () => {
    expect(askedWhen(at(6), now)).toEqual({ value: -1, unit: "week" });
    expect(askedWhen(new Date(2026, 9, 1).toISOString(), now)).toEqual({ value: -1, unit: "month" });
    expect(askedWhen(at(14), now)).toEqual({ value: -0, unit: "day" });
  });

  it("交給 Intl.RelativeTimeFormat 顯示成「今天」「昨天」「3 天前」「上週」", () => {
    const f = new Intl.RelativeTimeFormat("zh-TW", { numeric: "auto" });
    const show = (iso: string) => {
      const w = askedWhen(iso, now);
      return f.format(w.value, w.unit);
    };
    expect([at(13), at(12), at(10), at(6)].map(show)).toEqual(["今天", "昨天", "3 天前", "上週"]);
  });
});

describe("狀態點與實體形狀（#331，畫板 K-Home）", () => {
  it("我的上傳：核准 success、審核中 primary、退回 danger", () => {
    expect(UPLOAD_DOT).toEqual({ approved: "success", in_review: "primary", partly_rejected: "danger", rejected: "danger" });
  });

  it("等你處理：只列數字大於 0 的，待審文件 primary、說法不同 conflict、回報 warning", () => {
    const base = { documents: 0, conflicts: 0, reports: 0, earliestReport: null, total: 0 };
    expect(waitingRows(base)).toEqual([]);
    expect(waitingRows({ ...base, documents: 3, conflicts: 2, reports: 1, total: 6 })).toEqual([
      { kind: "documents", count: 3, dot: "primary" },
      { kind: "conflicts", count: 2, dot: "conflict" },
      { kind: "reports", count: 1, dot: "warning" },
    ]);
    expect(waitingRows({ ...base, reports: 2, total: 2 }).map((r) => r.kind)).toEqual(["reports"]);
  });

  it("最近看過：人是圓形、部門是圓角方形、其他是小圓角", () => {
    expect(entityShape("person")).toBe("round");
    expect(entityShape("team")).toBe("rounded");
    expect(entityShape("building")).toBe("rounded");
    expect(entityShape("folder")).toBe("square");
    expect(entityShape(undefined)).toBe("square");
  });
});

const access = {
  visibilityLevels: [
    { id: "secret", label: {}, rank: 2, color: "#000000" },
    { id: "public", label: {}, rank: 0, color: "#000000" },
    { id: "internal", label: {}, rank: 1, color: "#000000" },
  ],
  projects: [{ id: "p1", label: {} }],
  roles: [
    { id: "guest", label: {}, scope: {}, visibility: "public", projects: [], canUpload: false, canReview: false },
    { id: "staff", label: {}, scope: {}, visibility: "internal", projects: ["p1"], canUpload: true, canReview: false },
  ],
} as unknown as AccessFile;

describe("visibleScope", () => {
  it("等級不高於身分的可見等級，由低到高；專案是身分所屬的", () => {
    expect(visibleScope(access, "guest")).toEqual({ levels: ["public"], projects: [] });
    expect(visibleScope(access, "staff")).toEqual({ levels: ["public", "internal"], projects: ["p1"] });
  });

  it("不認得的身分什麼都看不到", () => {
    expect(visibleScope(access, "nobody")).toEqual({ levels: [], projects: [] });
  });
});

describe("roleScenarios", () => {
  it("只列情境角色是目前身分的情境", () => {
    const scenarios = { scenarios: [{ id: "x", role: "guest" }, { id: "y", role: "staff" }, { id: "z", role: "staff" }] } as unknown as ScenariosFile;
    expect(roleScenarios(scenarios, "staff").map((x) => x.id)).toEqual(["y", "z"]);
    expect(roleScenarios(scenarios, "manager")).toEqual([]);
  });
});

describe("rememberViewed", () => {
  it("最新的在前、不重複，最多 MAX_VIEWED 個", () => {
    expect(rememberViewed(["a", "b"], "b")).toEqual(["b", "a"]);
    const many = Array.from({ length: MAX_VIEWED }, (_, i) => `e${i}`);
    expect(rememberViewed(many, "new")).toEqual(["new", ...many.slice(0, MAX_VIEWED - 1)]);
  });
});

describe("reportUpdates（#286）", () => {
  const report = (id: string, reportedBy: string, resolvedAt: string | null) =>
    ({ id, reportedBy, resolvedAt, resolution: resolvedAt === null ? null : "not_error" }) as AnswerReport;

  it("只列自己回報、已處理的回報，處理時間新的在前", () => {
    const reports = [
      report("a", "staff", "2026-11-01T09:00:00Z"),
      report("b", "staff", null),
      report("c", "manager", "2026-11-05T09:00:00Z"),
      report("d", "staff", "2026-11-03T09:00:00Z"),
    ];
    expect(reportUpdates(reports, "staff").map((r) => r.id)).toEqual(["d", "a"]);
  });

  it("最多列出 max 則", () => {
    const reports = ["01", "02", "03", "04"].map((d) => report(d, "staff", `2026-11-${d}T09:00:00Z`));
    expect(reportUpdates(reports, "staff")).toHaveLength(MAX_UPDATES);
    expect(reportUpdates(reports, "staff", 1).map((r) => r.id)).toEqual(["04"]);
  });
});
