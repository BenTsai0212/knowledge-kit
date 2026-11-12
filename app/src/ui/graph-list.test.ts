import { describe, expect, it } from "vitest";
import { ALL } from "../graph/expansion";
import type { Graph } from "../graph/read";
import css from "./app.css?raw";
import { relationSentenceParts } from "./graph-keyboard";
import { entityTypeLabel } from "./graph-labels";
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

const all = (graph: Graph, excluded: ReadonlySet<string> = NONE) => listGroups(graph, listedEntities(graph, excluded, ALL, false), excluded, "en");
const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");
const outline = (groups: ListGroup[]) => groups.map((g) => [g.label, g.entities.map((e) => [e.label, e.sentences.map(text)])]);
const of = (groups: ListGroup[], id: string) => groups.flatMap((g) => g.entities).find((e) => e.entity.id === id)!;

describe("清單模式（#289）", () => {
  it("群組依知識模型的類型順序（h3），實體依名稱，關係句依相關實體的名稱；同名實體用消歧名稱", () => {
    expect(outline(all(full))).toEqual([
      [
        entityTypeLabel("person", "en"),
        [
          [
            "Chih-ming Lin (R&D)",
            ["Chih-ming Lin (R&D) Works on Long Bank", "Chih-ming Lin (R&D) Member of and Leads R&D", "Chih-ming Lin (R&D) Member of Sales"],
          ],
          ["Chih-ming Lin (Sales)", ["Chih-ming Lin (Sales) Member of Sales"]],
        ],
      ],
      [
        entityTypeLabel("team", "en"),
        [
          ["R&D", ["Chih-ming Lin (R&D) Member of and Leads R&D"]],
          ["Sales", ["Chih-ming Lin (R&D) Member of Sales", "Chih-ming Lin (Sales) Member of Sales"]],
        ],
      ],
      [entityTypeLabel("project", "en"), [["Long Bank", ["Chih-ming Lin (R&D) Works on Long Bank"]]]],
    ]);
  });

  it("關係句的主詞與受詞帶實體 id（做成連結），與報讀的句子相同", () => {
    const [sentence] = of(all(full), "j1").sentences;
    expect(sentence.filter((p) => p.entityId !== undefined).map((p) => p.entityId)).toEqual(["p1", "j1"]);
    expect(relationSentenceParts(full, [full.relations[0], full.relations[1]], "zh-TW").map(text)).toEqual(["林志明（產品研發部） 隸屬、負責 產品研發部"]);
    expect(listAnchor("p1")).toBe("graph-list-p1");
  });

  it("類型篩選：篩選掉的實體不列，也不出現在其他實體的關係句", () => {
    const groups = all(full, new Set(["j1"]));
    expect(groups.map((g) => g.type)).toEqual(["person", "team"]);
    expect(of(groups, "p1").sentences.map(text).join()).not.toContain("Long Bank");
  });

  it("「只看它」時只列聚焦集合；句中不在清單裡的實體不做連結", () => {
    const listed = listedEntities(full, NONE, ["t2"], true);
    expect([...listed].sort()).toEqual(["p1", "p2", "t2"]);
    const toRnD = of(listGroups(full, listed, NONE, "en"), "p1").sentences.find((parts) => text(parts).endsWith("R&D"))!;
    expect(toRnD.flatMap((p) => p.entityId ?? [])).toEqual(["p1"]);
    // 只是展開（沒有按「只看它」）時列出全部
    expect(listedEntities(full, NONE, ["t2"], false).size).toBe(full.entities.length);
  });

  it("只列出目前身分看得到的實體與關係（#247）", () => {
    const words = (groups: ListGroup[]) => JSON.stringify(outline(groups));
    expect(words(all(full))).toContain("Long Bank");
    expect(words(all(limited))).not.toContain("Long Bank");
    expect(of(all(limited), "p1").sentences).toHaveLength(2);
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
