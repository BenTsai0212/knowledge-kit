// target 測試：與客戶無關的斷言，npm test 以 client/ 執行，客戶檢查（npm run check:clients）以選定的客戶執行（#77）
import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import { evalQuestions } from "./load";
import { validateEvals } from "./validate";

describe("選定客戶的題庫", () => {
  it("通過跨檔檢查（含以 oracle 計算的可見範圍：答案段落看得到、權限題的段落看不到）", () => {
    expect(validateEvals(clientConfig, dataset, evalQuestions)).toEqual([]);
  });
});
