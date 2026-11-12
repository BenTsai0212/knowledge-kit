import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { strings } from "../client/i18n";
import { clusterGraph, filterGraph, type ClusterModel } from "../graph/clusters";
import { ALL } from "../graph/expansion";
import type { Graph } from "../graph/read";
import css from "./app.css?raw";
import { relationSentenceParts } from "./graph-keyboard";
import { listAnchor, listedEntities, listGroups, loadGraphMode, saveGraphMode, type ListGroup, type ModeStorage } from "./graph-list";

const entity = (id: string, type: string, zh: string, en: string) => ({ id, type, name: zh, names: { "zh-TW": zh, en }, sources: [] });
const relation = (id: string, type: string, from: string, to: string) => ({ id, type, from, to, sources: [] });

// 與 graph-keyboard.test.ts 相同：兩位林志明（同名），p1 隸屬並負責產品研發部、參與長堤專案、隸屬業務部；p2 隸屬業務部
const full: Graph = {
  entities: [
    entity("j1", "project", "長堤專案", "Long Bank"),
    entity("p2", "person", "林志明", "Chih-ming Lin"),
    entity("t1", "team", "產品研發部", "R&D"),
    entity("p1", "person", "林志明", "Chih-ming Lin"),
    entity("t2", "team", "業務部", "Sales"),
  ],
  relations: [
    relation("r1", "member-of", "p1", "t1"),
    relation("r2", "leads", "p1", "t1"),
    relation("r3", "works-on", "p1", "j1"),
    relation("r4", "member-of", "p2", "t2"),
    relation("r5", "member-of", "p1", "t2"),
  ],
};
// 另一個身分看不到長堤專案（readGraph() 不回傳它與它的關係）
const limited: Graph = { entities: full.entities.filter((e) => e.id !== "j1"), relations: full.relations.filter((r) => r.id !== "r3") };
const NONE = new Set<string>();

// 清單的分群與圖譜頁相同：篩選後的圖（這裡只有排除的實體）的 clusterGraph()
const MODEL = clientConfig.knowledgeModel;
const clusteringOf = (graph: Graph, excluded: ReadonlySet<string> = NONE, model: ClusterModel = MODEL) =>
  clusterGraph({ entities: graph.entities.filter((e) => !excluded.has(e.id)), relations: graph.relations.filter((r) => !excluded.has(r.from) && !excluded.has(r.to)) }, model);
const all = (graph: Graph, excluded: ReadonlySet<string> = NONE) =>
  listGroups(graph, clusteringOf(graph, excluded), listedEntities(graph, excluded, ALL, false), excluded, "en");
const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");
const outline = (groups: ListGroup[]) => groups.map((g) => [g.label, g.entities.map((e) => [e.label, e.sentences.map(text)])]);
const of = (groups: ListGroup[], id: string) => groups.flatMap((g) => g.entities).find((e) => e.entity.id === id)!;

describe("清單模式（#289）", () => {
  it("群組是 clusterGraph() 的分群（#254）：群組依實體數，群內代表實體在最前、其他依名稱；關係句依相關實體的名稱；同名實體用消歧名稱", () => {
    // 參考情境的部門與專案是容器：p1 連到兩個部門與一個專案，歸入關係較多的產品研發部
    const groups = all(full);
    expect(groups.map((g) => [g.id, g.kind, g.type])).toEqual([
      ["t1", "container", "team"],
      ["t2", "container", "team"],
      ["j1", "container", "project"],
    ]);
    expect(outline(groups)).toEqual([
      [
        "R&D",
        [
          ["R&D", ["Chih-ming Lin (R&D) Member of and Leads R&D"]],
          [
            "Chih-ming Lin (R&D)",
            ["Chih-ming Lin (R&D) Works on Long Bank", "Chih-ming Lin (R&D) Member of and Leads R&D", "Chih-ming Lin (R&D) Member of Sales"],
          ],
        ],
      ],
      [
        "Sales",
        [
          ["Sales", ["Chih-ming Lin (R&D) Member of Sales", "Chih-ming Lin (Sales) Member of Sales"]],
          ["Chih-ming Lin (Sales)", ["Chih-ming Lin (Sales) Member of Sales"]],
        ],
      ],
      ["Long Bank", [["Long Bank", ["Chih-ming Lin (R&D) Works on Long Bank"]]]],
    ]);
  });

  it("連不到容器的實體列在「其他」（名稱來自 client/i18n/），排在最後、沒有類型圖示", () => {
    // 篩掉部門：只剩專案是容器，p2 連不到任何容器
    const groups = all(full, new Set(["t1", "t2"]));
    expect(groups.map((g) => [g.label, g.kind, g.type, g.entities.map((e) => e.entity.id)])).toEqual([
      ["Long Bank", "container", "project", ["j1", "p1"]],
      [strings("en").graphZoom.other, "other", null, ["p2"]],
    ]);
  });

  it("沒有容器類型時以社群偵測分群，群組名稱是群內關聯最多的實體；每個實體只列一次", () => {
    const model: ClusterModel = { entityTypes: MODEL.entityTypes.map(({ id }) => ({ id })) };
    const groups = listGroups(full, clusteringOf(full, NONE, model), listedEntities(full, NONE, ALL, false), NONE, "en");
    expect(groups.every((g) => g.kind === "community")).toBe(true);
    expect(groups.map((g) => g.label)).toEqual(groups.map((g) => g.entities[0].label));
    expect(groups.flatMap((g) => g.entities.map((e) => e.entity.id)).sort()).toEqual(full.entities.map((e) => e.id).sort());
  });

  it("關係句的主詞與受詞帶實體 id（做成連結），與報讀的句子相同", () => {
    const [sentence] = of(all(full), "j1").sentences;
    expect(sentence.filter((p) => p.entityId !== undefined).map((p) => p.entityId)).toEqual(["p1", "j1"]);
    expect(relationSentenceParts(full, [full.relations[0], full.relations[1]], "zh-TW").map(text)).toEqual(["林志明（產品研發部） 隸屬、負責 產品研發部"]);
    expect(listAnchor("p1")).toBe("graph-list-p1");
  });

  it("類型篩選：篩選掉的實體不列，也不出現在其他實體的關係句", () => {
    const groups = all(full, new Set(["j1"]));
    expect(groups.map((g) => g.id)).toEqual(["t1", "t2"]);
    expect(of(groups, "p1").sentences.map(text).join()).not.toContain("Long Bank");
  });

  it("「只顯示關聯 ≥ N」：與圖譜相同，以篩選後的圖分群", () => {
    const filtered = filterGraph(full, { types: null, minRelations: 2 });
    const excluded = new Set(full.entities.map((e) => e.id).filter((id) => !filtered.entities.some((e) => e.id === id)));
    const groups = listGroups(full, clusterGraph(filtered, MODEL), listedEntities(full, excluded, ALL, false), excluded, "en");
    expect(groups.map((g) => [g.id, g.entities.map((e) => e.entity.id)])).toEqual([
      ["t1", ["t1", "p1"]],
      ["t2", ["t2"]],
    ]);
  });

  it("「只看它」時只列聚焦集合；句中不在清單裡的實體不做連結", () => {
    const listed = listedEntities(full, NONE, ["t2"], true);
    expect([...listed].sort()).toEqual(["p1", "p2", "t2"]);
    const toRnD = of(listGroups(full, clusteringOf(full), listed, NONE, "en"), "p1").sentences.find((parts) => text(parts).endsWith("R&D"))!;
    expect(toRnD.flatMap((p) => p.entityId ?? [])).toEqual(["p1"]);
    // 只是展開（沒有按「只看它」）時列出全部
    expect(listedEntities(full, NONE, ["t2"], false).size).toBe(full.entities.length);
  });

  it("只列出目前身分看得到的實體與關係（#247）", () => {
    const words = (groups: ListGroup[]) => JSON.stringify(outline(groups));
    expect(words(all(full))).toContain("Long Bank");
    expect(words(all(limited))).not.toContain("Long Bank");
    expect(of(all(limited), "p1").sentences).toHaveLength(2);
    // 群組與群組名稱也只來自看得到的實體：看不到的專案不成為群組，列出的實體數等於看得到的實體數
    expect(all(limited).map((g) => g.id)).toEqual(["t1", "t2"]);
    expect(all(limited).flatMap((g) => g.entities)).toHaveLength(limited.entities.length);
  });

  it("目前的實體以 aria-current 標出", () => {
    expect(css).toMatch(/\.graph-list li\[aria-current="true"\]/);
  });
});

describe("「圖譜｜清單」的選擇記在這個瀏覽器（#289）", () => {
  const memory = (): ModeStorage & { items: Map<string, string> } => {
    const items = new Map<string, string>();
    return { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v) };
  };

  it("預設是圖譜，選了清單之後記住", () => {
    const storage = memory();
    expect(loadGraphMode(storage)).toBe("graph");
    saveGraphMode("list", storage);
    expect(loadGraphMode(storage)).toBe("list");
    expect([...storage.items.keys()]).toEqual(["kk.graphMode"]);
  });

  it("不認得的值與無法使用的儲存回到圖譜，不拋錯", () => {
    const storage = memory();
    storage.setItem("kk.graphMode", "map");
    expect(loadGraphMode(storage)).toBe("graph");
    const broken: ModeStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadGraphMode(broken)).toBe("graph");
    expect(() => saveGraphMode("list", broken)).not.toThrow();
  });
});
