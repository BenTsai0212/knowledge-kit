import { describe, expect, it } from "vitest";
import { TRANSLATIONS } from "../client/i18n";
import { MAX_QUESTION_CHARS } from "../qa/prompt";
import { COUNTER_FROM, errorCategory, needsReload, questionLength, turnError, type ErrorCategory } from "./qa-errors";

// docs/design.md「錯誤與額度」的五類
const EXPECTED: Record<ErrorCategory, string[]> = {
  transient: ["upstream_overloaded", "upstream_timeout", "upstream_error", "limit_unavailable", "network", "unexpected_response", "upstream_interrupted"],
  fixQuestion: ["empty_question", "question_too_long", "prompt_too_long"],
  dailyLimit: ["daily_limit", "global_daily_limit"],
  admin: ["unknown_model", "misconfigured", "upstream_quota", "forbidden_origin", "invalid_request", "method_not_allowed"],
  modelRefusal: ["upstream_refusal"],
};

describe("errorCategory", () => {
  for (const [category, errors] of Object.entries(EXPECTED)) {
    for (const error of errors) {
      it(`${error} → ${category}`, () => expect(errorCategory(error)).toBe(category));
    }
  }

  it("翻譯檔的每一種錯誤類型（invalid_access_code 以外）都在五類中，且只出現一次", () => {
    const listed = Object.values(EXPECTED).flat();
    expect(new Set(listed).size).toBe(listed.length);
    for (const s of Object.values(TRANSLATIONS)) {
      expect(Object.keys(s.errors).filter((e) => e !== "invalid_access_code").sort()).toEqual([...listed].sort());
    }
  });

  it("不認得的錯誤類型當作暫時的問題（可以再試）", () => {
    expect(errorCategory("something_new")).toBe("transient");
    expect(errorCategory("toString")).toBe("transient");
  });

  it("只有 invalid_request、method_not_allowed 的下一步是重新整理頁面", () => {
    const reload = EXPECTED.admin.filter(needsReload);
    expect(reload).toEqual(["invalid_request", "method_not_allowed"]);
  });
});

describe("questionLength", () => {
  it("接近上限時顯示字數，超過上限時停用", () => {
    expect(questionLength("a".repeat(COUNTER_FROM - 1))).toEqual({ show: false, over: false });
    expect(questionLength("a".repeat(COUNTER_FROM))).toEqual({ show: true, over: false });
    expect(questionLength("a".repeat(MAX_QUESTION_CHARS))).toEqual({ show: true, over: false });
    expect(questionLength("a".repeat(MAX_QUESTION_CHARS + 23))).toEqual({ show: true, over: true });
  });

  it("與送出前的檢查相同，不算前後的空白", () => {
    expect(questionLength(` ${"a".repeat(MAX_QUESTION_CHARS)}  `).over).toBe(false);
  });
});

describe("turnError", () => {
  it("完全失敗與中斷的回答都取得錯誤類型", () => {
    expect(turnError({ kind: "error", error: "network" })).toBe("network");
    expect(turnError({ kind: "answer", error: "network" })).toBe("network");
    expect(turnError({ kind: "answer" })).toBeUndefined();
    expect(turnError({ kind: "refusal" })).toBeUndefined();
    expect(turnError(undefined)).toBeUndefined();
  });
});
