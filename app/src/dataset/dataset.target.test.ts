// target 測試：與客戶無關的斷言，npm test 以 client/ 執行，客戶檢查（npm run check:clients）以選定的客戶執行（#77）
import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { dataset } from "./load";
import { validateDataset } from "./validate";

describe("選定客戶的資料集", () => {
  it("通過跨檔檢查", () => {
    expect(validateDataset(clientConfig, dataset)).toEqual([]);
  });

  it("有文件", () => {
    expect(Object.keys(dataset.documents).length).toBeGreaterThan(0);
  });
});
