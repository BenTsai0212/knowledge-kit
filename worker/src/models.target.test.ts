// target 測試：與客戶無關的斷言，npm test 以 client/ 執行，客戶檢查（npm run check:clients）以選定的客戶執行（#77）
import { describe, expect, it } from "vitest";
import client from "@client/client.json";
import { isModelCode } from "./models";

describe("選定客戶的模型", () => {
  it("client.json 的 model 代號存在於 Worker 的白名單", () => {
    expect(isModelCode(client.model), client.model).toBe(true);
  });
});
