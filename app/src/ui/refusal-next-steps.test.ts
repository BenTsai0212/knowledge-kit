import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { TRANSLATIONS } from "../client/i18n";
import type { RelationType } from "../client/types";
import type { Graph, GraphEntity } from "../graph/read";
import { MAX_REFUSAL_ENTITIES, questionEntities, REFUSAL_CHOICES, refusalChoiceNext, refusalNextSteps, type RefusalChoiceNext, type RefusalSuggestion } from "./refusal-next-steps";

const entity = (id: string, type: string, name: string, names: Record<string, string> = {}): GraphEntity => ({ id, type, name, names, sources: [] });
const RELATION_TYPES: RelationType[] = [
  {
    id: "leads",
    label: { "zh-TW": "負責", en: "Leads" },
    from: ["person"],
    to: ["project"],
    questions: { incoming: { "zh-TW": "誰負責{name}？", en: "Who leads {name}?" } },
    owner: { "zh-TW": "負責人" },
  },
  { id: "works-on", label: { "zh-TW": "參與", en: "Works on" }, from: ["person"], to: ["project"] },
];
const graph: Graph = {
  entities: [entity("p1", "project", "甲專案", { en: "Project A" }), entity("p2", "project", "乙專案"), entity("u1", "person", "王小明"), entity("u2", "person", "陳小華")],
  relations: [
    { id: "r1", type: "works-on", from: "u2", to: "p1", sources: [] },
    { id: "r2", type: "leads", from: "u1", to: "p1", sources: [] },
  ],
};
const steps = (question: string, language = "zh-TW", g: Graph = graph, canUpload = false) =>
  refusalNextSteps({ canUpload, graph: g, question, language, relationTypes: RELATION_TYPES });
const summary = (list: RefusalSuggestion[]) =>
  list.map((x) => (x.kind === "step" ? x.step : x.kind === "owner" ? `owner:${x.entity.id}<${x.owner.id}:${x.role}` : `${x.kind}:${x.entity.id}`));

describe("refusalNextSteps：通用建議", () => {
  it("能上傳的身分多一項上傳；換個說法與改問負責的人永遠都有", () => {
    expect(summary(refusalNextSteps({ canUpload: true }))).toEqual(["rephrase", "askPerson", "upload"]);
    expect(summary(refusalNextSteps({ canUpload: false }))).toEqual(["rephrase", "askPerson"]);
  });

  it("問題中沒有看得到的實體、或沒有圖譜時，退回通用建議", () => {
    expect(summary(steps("今年的預算是多少？", "zh-TW", graph, true))).toEqual(["rephrase", "askPerson", "upload"]);
    expect(summary(refusalNextSteps({ canUpload: false, question: "甲專案的預算", language: "zh-TW" }))).toEqual(["rephrase", "askPerson"]);
  });

  it("清單的文字不提權限、等級、專案或身分", () => {
    const { visibilityLevels, projects, roles } = clientConfig.access;
    const labels = [...visibilityLevels, ...projects, ...roles].flatMap((x) => Object.values(x.label));
    for (const [language, s] of Object.entries(TRANSLATIONS)) {
      const text = [
        s.refusalNextTitle,
        s.refusalNextRephrase,
        s.refusalNextAskPerson,
        s.refusalNextUpload,
        s.refusalNextGraph,
        s.refusalNextOwner,
        s.refusalNextRephraseWith,
        s.refusalNextRephraseName,
        s.refusalGotoUpload,
      ].join("\n");
      for (const label of labels) expect(text, language).not.toContain(label);
      expect(text, language).not.toMatch(/權限|権限|permission|access/i);
    }
  });
});

describe("refusalNextSteps：從問題中看得到的實體產生（#285）", () => {
  it("在圖譜看它、問它的負責人、用它換個問法；上傳在最後", () => {
    const list = steps("甲專案的預算是多少？", "zh-TW", graph, true);
    expect(summary(list)).toEqual(["graph:p1", "owner:p1<u1:負責人", "rephrase:p1", "upload"]);
    // 換個問法是「接著問」的第一題
    expect(list[2]).toMatchObject({ kind: "rephrase", question: expect.stringContaining("甲專案") });
  });

  it("負責人的稱呼缺介面語言時用關係的名稱；沒有 owner 的關係不算負責人", () => {
    expect(summary(steps("Project A budget", "en"))).toContain("owner:p1<u1:Leads");
    const onlyWorksOn: Graph = { ...graph, relations: graph.relations.filter((r) => r.type === "works-on") };
    expect(summary(steps("甲專案的預算", "zh-TW", onlyWorksOn))).toEqual(["graph:p1", "rephrase:p1"]);
  });

  it("沒有接著問時，換個問法只放名稱", () => {
    const alone: Graph = { entities: graph.entities, relations: [] };
    expect(steps("乙專案的預算", "zh-TW", alone).at(-1)).toMatchObject({ kind: "rephrase", question: null });
  });

  it("依在問題中出現的順序，最多 MAX_REFUSAL_ENTITIES 個；不分大小寫，各語言的名稱都算", () => {
    expect(questionEntities(graph, "陳小華、王小明與乙專案").map((e) => e.id)).toEqual(["u2", "u1", "p2"].slice(0, MAX_REFUSAL_ENTITIES));
    expect(questionEntities(graph, "budget of PROJECT a").map((e) => e.id)).toEqual(["p1"]);
  });

  it("輸入只有問題、上傳能力與圖譜：多傳拒答原因不影響結果", () => {
    const extra = (reason: string) =>
      ({ canUpload: true, graph, question: "甲專案", language: "zh-TW", relationTypes: RELATION_TYPES, reason }) as Parameters<typeof refusalNextSteps>[0];
    expect(refusalNextSteps(extra("no_data"))).toEqual(refusalNextSteps(extra("no_permission")));
  });

  it("圖譜中沒有的實體（看不到）不會出現；問題只提到它時與資料不存在相同", () => {
    const hidden = { ...graph, entities: graph.entities.filter((e) => e.id !== "p1"), relations: [] };
    expect(summary(steps("甲專案的預算", "zh-TW", hidden))).toEqual(summary(steps("丙專案的預算", "zh-TW", hidden)));
    expect(summary(steps("甲專案的預算", "zh-TW", hidden))).toEqual(["rephrase", "askPerson"]);
  });
});

describe("refusalChoiceNext：先確認要找的是哪一種（#377）", () => {
  const next = (choice: Parameters<typeof refusalChoiceNext>[0], question: string, canUpload = false, g: Graph = graph) =>
    refusalChoiceNext(choice, { canUpload, graph: g, question, language: "zh-TW", relationTypes: RELATION_TYPES });
  // 實體以 id 表示，方便比對
  const brief = (x: RefusalChoiceNext) => {
    if (x.choice === "skip") return { choice: x.choice, steps: summary(x.steps) };
    if (x.choice === "personal") return x;
    return { ...x, owner: x.owner && `${x.owner.owner.id}:${x.owner.entity.id}:${x.owner.role}`, ...(x.choice === "people" && { entity: x.entity?.id ?? null }) };
  };

  it("公司的規定或辦法：有負責人時改問他（沿用「問負責的人」的實體與稱呼），沒有看得到的實體時只給換詞", () => {
    expect(brief(next("policy", "甲專案的預算是多少？"))).toEqual({ choice: "policy", owner: "u1:p1:負責人", upload: false });
    expect(brief(next("policy", "今年的預算是多少？"))).toEqual({ choice: "policy", owner: null, upload: false });
    // 有實體但沒有負責人：同樣只給換詞
    expect(brief(next("policy", "乙專案的預算"))).toEqual({ choice: "policy", owner: null, upload: false });
  });

  it("我自己的情況：有沒有看得到的實體都相同", () => {
    expect(next("personal", "甲專案的預算是多少？")).toEqual({ choice: "personal", upload: false });
    expect(next("personal", "今年的預算是多少？")).toEqual(next("personal", "甲專案的預算是多少？"));
  });

  it("某個人或部門的事：在圖譜看第一個實體、問它的負責人；沒有看得到的實體時是通用的一句", () => {
    expect(brief(next("people", "甲專案的預算是多少？"))).toEqual({ choice: "people", entity: "p1", owner: "u1:p1:負責人", upload: false });
    expect(brief(next("people", "乙專案的預算"))).toEqual({ choice: "people", entity: "p2", owner: null, upload: false });
    expect(brief(next("people", "今年的預算是多少？"))).toEqual({ choice: "people", entity: null, owner: null, upload: false });
  });

  it("能上傳的身分，三種選擇下方都有上傳一行", () => {
    for (const choice of REFUSAL_CHOICES) {
      expect(next(choice, "甲專案的預算", true)).toMatchObject({ upload: true });
      expect(next(choice, "今年的預算", false)).toMatchObject({ upload: false });
    }
  });

  it("略過時等於現行的「可以試試」清單", () => {
    for (const [question, canUpload] of [["甲專案的預算是多少？", true], ["今年的預算", false]] as const) {
      expect(next("skip", question, canUpload)).toEqual({ choice: "skip", steps: steps(question, "zh-TW", graph, canUpload) });
    }
  });

  it("看不到的實體不會出現：問題只提到它時，與資料不存在的問題相同；多傳拒答原因不影響結果", () => {
    const hidden = { ...graph, entities: graph.entities.filter((e) => e.id !== "p1"), relations: [] };
    for (const choice of [...REFUSAL_CHOICES, "skip"] as const) {
      expect(next(choice, "甲專案的預算", true, hidden)).toEqual(next(choice, "丙專案的預算", true, hidden));
      const extra = (reason: string) =>
        ({ canUpload: true, graph, question: "甲專案", language: "zh-TW", relationTypes: RELATION_TYPES, reason }) as Parameters<typeof refusalNextSteps>[0];
      expect(refusalChoiceNext(choice, extra("no_data"))).toEqual(refusalChoiceNext(choice, extra("no_permission")));
    }
  });

  it("各語言的文字不提權限、等級、專案或身分", () => {
    const { visibilityLevels, projects, roles } = clientConfig.access;
    const labels = [...visibilityLevels, ...projects].flatMap((x) => Object.values(x.label));
    const roleLabels = roles.flatMap((x) => Object.values(x.label));
    for (const [language, s] of Object.entries(TRANSLATIONS)) {
      const text = [
        s.refusalClarifyTitle,
        s.refusalClarifyQuestion,
        s.refusalClarifyPolicy,
        s.refusalClarifyPersonal,
        s.refusalClarifyPeople,
        s.refusalClarifySkip,
        s.refusalClarifyYourTurn,
        s.refusalClarifyPolicyOwner,
        s.refusalClarifyPolicyNext,
        s.refusalClarifyPeopleOwner,
        s.refusalClarifyPeopleEntity,
        s.refusalClarifyPeopleNext,
        s.refusalClarifyOwnerName,
      ].join("\n");
      for (const label of [...labels, ...roleLabels]) expect(text, language).not.toContain(label);
      expect(text, language).not.toMatch(/權限|権限|permission|access/i);
      // 「我自己的情況」的下一步是規格指定的「問你的主管」：指的是使用者自己的上司，與身分無關；仍不提權限、等級與專案
      for (const label of labels) expect(s.refusalClarifyPersonalNext, language).not.toContain(label);
      expect(s.refusalClarifyPersonalNext, language).not.toMatch(/權限|権限|permission|access/i);
    }
  });
});
