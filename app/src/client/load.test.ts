import { describe, expect, it } from "vitest";
import clientSchema from "../../../client/schema/client.schema.json";
import { clientConfig, normalizeClient, RETRIEVAL_DEFAULTS } from "./load";
import type { ClientFiles } from "./types";

describe("normalizeClient", () => {
  it("mergeStrategy 省略時為 review，有填時保留", () => {
    const byId = Object.fromEntries(clientConfig.knowledgeModel.entityTypes.map((t) => [t.id, t.mergeStrategy]));
    expect(byId).toEqual({ person: "review", team: "auto", project: "review" });
  });

  it("不修改傳入的設定", () => {
    const raw = {
      client: { retrieval: { topK: 3 } },
      knowledgeModel: {
        entityTypes: [{ id: "x", label: { "zh-TW": "x" }, aliasRules: { ignoreCase: true, normalizeWidth: true, ignoreWhitespace: true } }],
        relationTypes: [],
      },
    } as unknown as ClientFiles;
    const config = normalizeClient(raw);
    expect(config.knowledgeModel.entityTypes[0].mergeStrategy).toBe("review");
    expect(raw.knowledgeModel.entityTypes[0]).not.toHaveProperty("mergeStrategy");
    expect(raw.client.retrieval).toEqual({ topK: 3 });
  });

  it("retrieval 省略的欄位補上預設值，有填時保留", () => {
    const raw = (retrieval?: object) => ({ ...clientConfig, client: { ...clientConfig.client, retrieval } }) as unknown as ClientFiles;
    expect(normalizeClient(raw()).client.retrieval).toEqual(RETRIEVAL_DEFAULTS);
    expect(normalizeClient(raw({ topK: 3 })).client.retrieval).toEqual({ ...RETRIEVAL_DEFAULTS, topK: 3 });
  });

  it("retrieval 的預設值與 Schema 的 default 相同", () => {
    const props = clientSchema.properties.retrieval.properties;
    expect(RETRIEVAL_DEFAULTS).toEqual({ provider: props.provider.default, topK: props.topK.default, minScore: props.minScore.default });
  });

  it("讀入 client/ 的範例設定", () => {
    expect(clientConfig.client.displayName["zh-TW"]).toBe("範例公司");
    expect(clientConfig.client.languages).toEqual(["zh-TW", "en"]);
  });
});
