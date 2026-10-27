import { describe, expect, it } from "vitest";
import client from "../../client/client.json";
import { isModelCode, MODELS } from "./models";

describe("模型白名單", () => {
  it("client.json 的 model 代號存在於白名單", () => {
    expect(isModelCode(client.model), client.model).toBe(true);
  });

  it("只認自己的鍵，不認繼承的屬性或實際模型名稱", () => {
    expect(isModelCode("toString")).toBe(false);
    expect(isModelCode(MODELS.standard.model)).toBe(false);
  });
});
