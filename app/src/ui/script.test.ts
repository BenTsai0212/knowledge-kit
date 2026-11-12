// 展示模式的劇本（#260 PR 2）：分組順序、「第 N／M 題」、已問過與切換身分的判斷。畫面上的點選與身分切換以 E2E（e2e/presentation.spec.ts）確認
import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { scriptItems, scriptKey, scriptPosition, switchesIdentity, wasAsked } from "./script";

const config = {
  scenarios: [
    { id: "a", title: { en: "A" }, role: "guest", questions: [{ id: "q1", text: { en: "One?" }, answerPassages: [] }] },
    {
      id: "b",
      title: { en: "B" },
      role: "staff",
      questions: [
        { id: "q1", text: { en: "Two?" }, answerPassages: [] },
        { id: "q2", text: { en: "Three?" }, answerPassages: [] },
      ],
    },
  ],
};

describe("scriptItems", () => {
  it("照 scenarios.json 的順序攤平，key 由情境與問題 id 組成、帶情境的身分", () => {
    expect(scriptItems(config).map((i) => [i.key, i.role, i.text.en])).toEqual([
      ["a/q1", "guest", "One?"],
      ["b/q1", "staff", "Two?"],
      ["b/q2", "staff", "Three?"],
    ]);
  });

  it("參考情境的每一題都有唯一的 key", () => {
    const keys = scriptItems(clientConfig.scenarios).map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(clientConfig.scenarios.scenarios.reduce((n, s) => n + s.questions.length, 0));
  });
});

describe("scriptPosition（第 N／M 題）", () => {
  const items = scriptItems(config);

  it("目前題目的位置從 1 起，M 是劇本的總題數", () => {
    expect(scriptPosition(items, scriptKey("a", "q1"))).toEqual({ index: 1, total: 3 });
    expect(scriptPosition(items, scriptKey("b", "q2"))).toEqual({ index: 3, total: 3 });
  });

  it("還沒點過劇本、或找不到的 key：沒有目前題目", () => {
    expect(scriptPosition(items, null)).toEqual({ index: null, total: 3 });
    expect(scriptPosition(items, "x/y")).toEqual({ index: null, total: 3 });
  });
});

describe("wasAsked（已問過 ✓）", () => {
  const conversations = { staff: [{ question: "Two?" }], guest: [] };

  it("只看該情境身分的對話", () => {
    expect(wasAsked(conversations, "staff", "Two?")).toBe(true);
    expect(wasAsked(conversations, "guest", "Two?")).toBe(false);
    expect(wasAsked(conversations, "manager", "Two?")).toBe(false);
    expect(wasAsked(conversations, "staff", "Three?")).toBe(false);
  });
});

describe("switchesIdentity（先切身分再送出、徽章 settle）", () => {
  it("情境身分不是目前身分時才切換", () => {
    expect(switchesIdentity({ role: "staff" }, "guest")).toBe(true);
    expect(switchesIdentity({ role: "staff" }, "staff")).toBe(false);
  });
});
