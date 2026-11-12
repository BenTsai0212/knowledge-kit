import { describe, expect, it } from "vitest";
import type { AccessFile, ScenariosFile } from "../client/types";
import type { ReviewDocument, ReviewStatus } from "../extraction/store";
import { greetingPeriod, MAX_ASKED, MAX_VIEWED, rememberQuestion, rememberViewed, roleScenarios, visibleScope, waitingSummary } from "./home";
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

describe("rememberQuestion", () => {
  it("最新的在前，同一個問題只留最新的一次", () => {
    expect(rememberQuestion(["b", "a"], "a")).toEqual(["a", "b"]);
    expect(rememberQuestion(["b", "a"], "c")).toEqual(["c", "b", "a"]);
  });

  it("去掉前後空白，空白的問題不記", () => {
    expect(rememberQuestion(["a"], "  b \n")).toEqual(["b", "a"]);
    expect(rememberQuestion(["a"], "   ")).toEqual(["a"]);
  });

  it(`最多保留 ${MAX_ASKED} 筆`, () => {
    let asked: string[] = [];
    for (let i = 0; i < MAX_ASKED + 5; i++) asked = rememberQuestion(asked, `q${i}`);
    expect(asked).toHaveLength(MAX_ASKED);
    expect(asked[0]).toBe(`q${MAX_ASKED + 4}`);
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
    { id: "guest", label: {}, visibility: "public", projects: [], canUpload: false, canReview: false },
    { id: "staff", label: {}, visibility: "internal", projects: ["p1"], canUpload: true, canReview: false },
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
