import { describe, expect, it } from "vitest";
import clientSchema from "../../../client/schema/client.schema.json";
import { RETRIEVAL_DEFAULTS } from "../retrieval/providers";
import { clientConfig, CONFLICTS_DEFAULTS, EVAL_THRESHOLDS_DEFAULTS, normalizeClient, UPLOAD_DEFAULTS } from "./load";
import type { ClientFiles } from "./types";

describe("normalizeClient", () => {
  it("mergeStrategy 省略時為 review，有填時保留", () => {
    const byId = Object.fromEntries(clientConfig.knowledgeModel.entityTypes.map((t) => [t.id, t.mergeStrategy]));
    expect(byId).toEqual({ person: "review", team: "auto", project: "review" });
  });

  it("icon 省略時為 generic，有填時保留", () => {
    const byId = Object.fromEntries(clientConfig.knowledgeModel.entityTypes.map((t) => [t.id, t.icon]));
    expect(byId).toEqual({ person: "person", team: "team", project: "folder" });
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
    expect(config.knowledgeModel.entityTypes[0].icon).toBe("generic");
    expect(raw.knowledgeModel.entityTypes[0]).not.toHaveProperty("mergeStrategy");
    expect(raw.knowledgeModel.entityTypes[0]).not.toHaveProperty("icon");
    expect(raw.client.retrieval).toEqual({ topK: 3 });
  });

  it("retrieval 省略的欄位補上預設值，有填時保留", () => {
    const raw = (retrieval?: object) => ({ ...clientConfig, client: { ...clientConfig.client, retrieval } }) as unknown as ClientFiles;
    const keywordHash = RETRIEVAL_DEFAULTS["keyword-hash"];
    expect(normalizeClient(raw()).client.retrieval).toEqual(keywordHash);
    expect(normalizeClient(raw({ topK: 3 })).client.retrieval).toEqual({ ...keywordHash, topK: 3 });
  });

  it("retrieval 省略 minScore 時依 provider 補上（#163 決定 2）；有填時保留", () => {
    const raw = (retrieval?: object) => ({ ...clientConfig, client: { ...clientConfig.client, retrieval } }) as unknown as ClientFiles;
    expect(normalizeClient(raw({ provider: "multilingual-e5-small" })).client.retrieval).toEqual({ provider: "multilingual-e5-small", topK: 5, minScore: 0.7 });
    expect(normalizeClient(raw({ provider: "multilingual-e5-small", minScore: 0.8 })).client.retrieval.minScore).toBe(0.8);
    expect(normalizeClient(raw({ provider: "keyword-hash" })).client.retrieval.minScore).toBe(0.1);
    // 未登記的值保留，由 createProvider 拋錯
    expect(normalizeClient(raw({ provider: "pgvector" })).client.retrieval).toEqual({ ...RETRIEVAL_DEFAULTS["keyword-hash"], provider: "pgvector" });
  });

  it("retrieval 的預設值：keyword-hash 的列與 Schema 的 default 相同；每個實作都有一列", () => {
    const props = clientSchema.properties.retrieval.properties;
    expect(RETRIEVAL_DEFAULTS["keyword-hash"]).toEqual({ provider: props.provider.default, topK: props.topK.default, minScore: props.minScore.default });
    expect(Object.keys(RETRIEVAL_DEFAULTS).sort()).toEqual([...props.provider.enum].sort());
    for (const [id, row] of Object.entries(RETRIEVAL_DEFAULTS)) expect(row.provider).toBe(id);
  });

  it("讀入 client/ 的範例設定", () => {
    expect(clientConfig.client.displayName["zh-TW"]).toBe("範例公司");
    expect(clientConfig.client.languages).toEqual(["zh-TW", "en"]);
  });

  it("upload 省略時補上預設值，預設值與 Schema 的 default 相同", () => {
    const raw = (upload?: object) => ({ ...clientConfig, client: { ...clientConfig.client, upload } }) as unknown as ClientFiles;
    expect(normalizeClient(raw()).client.upload).toEqual(UPLOAD_DEFAULTS);
    expect(normalizeClient(raw({ passageMaxChars: 500 })).client.upload).toEqual({ ...UPLOAD_DEFAULTS, passageMaxChars: 500 });
    expect(UPLOAD_DEFAULTS.passageMaxChars).toBe(clientSchema.properties.upload.properties.passageMaxChars.default);
    expect(UPLOAD_DEFAULTS.extractMaxBatches).toBe(clientSchema.properties.upload.properties.extractMaxBatches.default);
  });

  it("conflicts 省略時補上預設值（預設關閉），預設值與 Schema 的 default 相同；範例客戶明確開啟", () => {
    const raw = (conflicts?: object) => ({ ...clientConfig, client: { ...clientConfig.client, conflicts } }) as unknown as ClientFiles;
    expect(normalizeClient(raw()).client.conflicts).toEqual(CONFLICTS_DEFAULTS);
    expect(CONFLICTS_DEFAULTS.enabled).toBe(false);
    expect(normalizeClient(raw({ minScore: 0.3 })).client.conflicts).toEqual({ ...CONFLICTS_DEFAULTS, minScore: 0.3 });
    const props = clientSchema.properties.conflicts.properties;
    expect(CONFLICTS_DEFAULTS).toEqual({ enabled: props.enabled.default, candidatesPerPassage: props.candidatesPerPassage.default, minScore: props.minScore.default });
    expect(clientConfig.client.conflicts.enabled).toBe(true);
  });

  it("評測門檻省略時補上預設值，預設值與 Schema 的 default 相同", () => {
    const raw = (thresholds?: object) =>
      ({ ...clientConfig, client: { ...clientConfig.client, evals: { path: "evals/", thresholds } } }) as unknown as ClientFiles;
    expect(normalizeClient(raw()).client.evals).toEqual({ path: "evals/", thresholds: EVAL_THRESHOLDS_DEFAULTS });
    expect(normalizeClient(raw({ answer: 0.7 })).client.evals.thresholds).toEqual({ ...EVAL_THRESHOLDS_DEFAULTS, answer: 0.7 });
    const props = clientSchema.properties.evals.properties.thresholds.properties;
    expect(EVAL_THRESHOLDS_DEFAULTS).toEqual({
      citation: props.citation.default,
      answer: props.answer.default,
      refusal: props.refusal.default,
    });
  });
});
