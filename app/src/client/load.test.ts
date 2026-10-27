import { describe, expect, it } from "vitest";
import { clientConfig, normalizeClient } from "./load";
import type { ClientFiles } from "./types";

describe("normalizeClient", () => {
  it("mergeStrategy 省略時為 review，有填時保留", () => {
    const byId = Object.fromEntries(clientConfig.knowledgeModel.entityTypes.map((t) => [t.id, t.mergeStrategy]));
    expect(byId).toEqual({ person: "review", team: "auto", project: "review" });
  });

  it("不修改傳入的設定", () => {
    const raw = {
      knowledgeModel: {
        entityTypes: [{ id: "x", label: { "zh-TW": "x" }, aliasRules: { ignoreCase: true, normalizeWidth: true, ignoreWhitespace: true } }],
        relationTypes: [],
      },
    } as unknown as ClientFiles;
    const config = normalizeClient(raw);
    expect(config.knowledgeModel.entityTypes[0].mergeStrategy).toBe("review");
    expect(raw.knowledgeModel.entityTypes[0]).not.toHaveProperty("mergeStrategy");
  });

  it("讀入 client/ 的範例設定", () => {
    expect(clientConfig.client.displayName["zh-TW"]).toBe("範例公司");
    expect(clientConfig.client.languages).toEqual(["zh-TW", "en"]);
  });
});
