import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import { evalQuestions } from "./load";
import type { QuestionsFile } from "./types";
import { validateEvals } from "./validate";

const FILE = "evals/questions.json";
const copy = (): QuestionsFile => structuredClone(evalQuestions);
const indexOf = (file: QuestionsFile, id: string) => file.questions.findIndex((q) => q.id === id);

describe("validateEvals", () => {
  it("答案段落必須存在於資料集", () => {
    const file = copy();
    const i = indexOf(file, "annual-leave-staff");
    file.questions[i].answerPassages.push("no-such-passage");
    expect(validateEvals(clientConfig, dataset, file)).toEqual([
      { file: FILE, path: `/questions/${i}/answerPassages/2`, message: "答案段落 no-such-passage 不存在於資料集" },
    ]);
  });

  it("預期回答時，答案段落都必須是該角色看得到的（以 oracle 計算）", () => {
    const file = copy();
    const i = indexOf(file, "bluewing-cost-manager");
    file.questions[i].role = "staff";
    expect(validateEvals(clientConfig, dataset, file)).toEqual([
      { file: FILE, path: `/questions/${i}/answerPassages/0`, message: "角色 staff 看不到答案段落 bluewing-cost-zh-01" },
    ]);
  });

  it("權限題預期拒答時，答案段落都必須是該角色看不到的（#62 決定 1）", () => {
    const file = copy();
    const i = indexOf(file, "bluewing-cost-staff");
    file.questions[i].role = "manager";
    expect(validateEvals(clientConfig, dataset, file)).toEqual([
      { file: FILE, path: `/questions/${i}/answerPassages/0`, message: "權限題的角色 manager 看得到答案段落 bluewing-cost-zh-01，應該能回答" },
    ]);
  });

  it("其他類別的拒答題不檢查答案段落是否看得到", () => {
    const file = copy();
    const i = indexOf(file, "ceo-cost-guest");
    file.questions[i].role = "manager";
    expect(validateEvals(clientConfig, dataset, file)).toEqual([]);
  });

  it("app 只支援 evals.path 為 evals/", () => {
    const config = structuredClone(clientConfig);
    config.client.evals.path = "tests/";
    expect(validateEvals(config, dataset, evalQuestions).map((e) => `${e.file} ${e.path}`)).toEqual(["client.json /evals/path"]);
  });
});

describe("參考情境的題庫", () => {
  const questions = evalQuestions.questions;

  it("題數符合 docs/playbook/eval-question-bank.md 的建議：情境題 8 題以上、預期回答 15 題以上（#75 決定）", () => {
    expect(questions.filter((q) => q.category === "scenario").length).toBeGreaterThanOrEqual(8);
    expect(questions.filter((q) => q.expect === "answer").length).toBeGreaterThanOrEqual(15);
  });

  it("繁中與英文都有，涵蓋每個類別", () => {
    expect(new Set(questions.map((q) => q.language))).toEqual(new Set(clientConfig.client.languages));
    expect(new Set(questions.map((q) => q.category))).toEqual(
      new Set(["scenario", "permission", "out-of-scope", "conflict", "extraction-attempt"]),
    );
  });

  it("涵蓋 scenarios.json 的每一題（同一個角色、相同的答案段落）", () => {
    for (const scenario of clientConfig.scenarios.scenarios) {
      for (const s of scenario.questions) {
        const match = questions.find(
          (q) =>
            q.role === scenario.role &&
            q.expect === "answer" &&
            Object.values(s.text).includes(q.question) &&
            s.answerPassages.every((id) => q.answerPassages.includes(id)),
        );
        expect(match, `${scenario.id}/${s.id}`).toBeDefined();
      }
    }
  });

  it("權限差異：同一個問題，有角色能答、有角色要拒答", () => {
    const pairs = questions.filter(
      (q) => q.expect === "refusal" && questions.some((o) => o.question === q.question && o.expect === "answer" && o.role !== q.role),
    );
    expect(pairs.length).toBeGreaterThanOrEqual(2);
  });

  it("矛盾題要求兩種說法都提到", () => {
    for (const q of questions.filter((q) => q.category === "conflict")) expect(q.keyPoints.length).toBeGreaterThanOrEqual(2);
  });
});
