import { describe, expect, it } from "vitest";
import { isModelCode, MODELS } from "./models";

// client.json 的 model 是否在白名單由 models.target.test.ts 檢查（客戶檢查也會執行）
describe("模型白名單", () => {
  it("只認自己的鍵，不認繼承的屬性或實際模型名稱", () => {
    expect(isModelCode("toString")).toBe(false);
    expect(isModelCode(MODELS.standard.model)).toBe(false);
  });
});
