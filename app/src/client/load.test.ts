import { describe, expect, it } from "vitest";
import clientSchema from "../../../client/schema/client.schema.json";
import { clientConfig, CONFLICTS_DEFAULTS, EVAL_THRESHOLDS_DEFAULTS, normalizeClient, RETRIEVAL_DEFAULTS, UPLOAD_DEFAULTS } from "./load";
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
