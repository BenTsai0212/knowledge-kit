import { describe, expect, it, vi } from "vitest";
import type { Graph } from "../graph/read";
import {
  ANNOUNCE_DEBOUNCE_MS,
  announceEnter,
  announceGo,
  announceMove,
  announceShown,
  createAnnouncer,
  entryEntity,
  keyAction,
  moveCursor,
  neighborsClockwise,
  relationSentences,
} from "./graph-keyboard";

const entity = (id: string, type: string, zh: string, en: string) => ({ id, type, name: zh, names: { "zh-TW": zh, en }, sources: [] });
const relation = (id: string, type: string, from: string, to: string) => ({ id, type, from, to, sources: [] });

// 兩位林志明（同名），p1 隸屬並負責產品研發部、參與長堤專案、隸屬業務部；p2 隸屬業務部
const full: Graph = {
  entities: [
    entity("p1", "person", "林志明", "Chih-ming Lin"),
    entity("p2", "person", "林志明", "Chih-ming Lin"),
    entity("t1", "team", "產品研發部", "R&D"),
    entity("t2", "team", "業務部", "Sales"),
    entity("j1", "project", "長堤專案", "Long Bank"),
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

// p1 在中央：產品研發部在 12 點鐘、長堤專案在 3 點鐘、業務部在 9 點鐘
const positions = new Map([
  ["p1", { x: 0, y: 0 }],
  ["t1", { x: 0, y: -100 }],
  ["j1", { x: 100, y: 0 }],
  ["t2", { x: -100, y: 0 }],
  ["p2", { x: -200, y: 0 }],
]);
const NONE = new Set<string>();
const ids = (list: { entity: { id: string } }[]) => list.map((n) => n.entity.id);

describe("按鍵（#289）", () => {
  const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
    keyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  it("依規格對應動作", () => {
    expect(["ArrowLeft", "ArrowRight", "Enter", "Backspace", " ", "a", "A", "/", "+", "-", "0", "Escape", "?"].map((k) => key(k))).toEqual([
      "prev", "next", "go", "back", "only", "ask", "ask", "search", "zoomIn", "zoomOut", "fit", "reset", "help",
    ]);
  });

  it("有 Ctrl／Meta／Alt 時與其他按鍵不處理", () => {
    expect(key("ArrowRight", { ctrlKey: true })).toBeNull();
    expect(key("a", { metaKey: true })).toBeNull();
    expect(key("0", { altKey: true })).toBeNull();
    expect(key("Tab")).toBeNull();
    expect(key("ArrowDown")).toBeNull();
  });
});

describe("相關實體的順序（#289）", () => {
  it("從 12 點鐘方向順時針", () => {
    expect(ids(neighborsClockwise(full, "p1", positions, NONE))).toEqual(["t1", "j1", "t2"]);
  });

  it("同一對實體的多種關係合併成一個相關實體", () => {
    expect(neighborsClockwise(full, "p1", positions, NONE)[0].relations.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("類型篩選掉的實體不列入；沒有位置時排在最後", () => {
    expect(ids(neighborsClockwise(full, "p1", positions, new Set(["j1"])))).toEqual(["t1", "t2"]);
    expect(ids(neighborsClockwise(full, "p1", new Map(), NONE))).toEqual(["j1", "t1", "t2"]);
  });

  it("只列出目前身分看得到的（#247）", () => {
    expect(ids(neighborsClockwise(limited, "p1", positions, NONE))).toEqual(["t1", "t2"]);
  });

  it("游標兩端相接；沒有游標時 → 從第一個、← 從最後一個開始；沒有相關實體時沒有游標", () => {
    expect(moveCursor(3, null, 1)).toBe(0);
    expect(moveCursor(3, null, -1)).toBe(2);
    expect(moveCursor(3, 2, 1)).toBe(0);
    expect(moveCursor(3, 0, -1)).toBe(2);
    expect(moveCursor(0, null, 1)).toBeNull();
  });
});

describe("進入圖譜的實體（#289 決定 2）", () => {
  it("有選取時是選取的實體，沒有時是關聯最多的實體", () => {
    expect(entryEntity(full, "t2", NONE, "zh-TW")).toBe("t2");
    expect(entryEntity(full, null, NONE, "zh-TW")).toBe("p1");
  });

  it("選取的實體看不到或已篩選掉時改用關聯最多的；篩選掉的類型不當起點", () => {
    expect(entryEntity(limited, "j1", NONE, "zh-TW")).toBe("p1");
    expect(entryEntity(full, null, new Set(["p1", "p2"]), "zh-TW")).toBe("t1");
  });
});

describe("報讀（#289）", () => {
  const neighbors = neighborsClockwise(full, "p1", positions, NONE);

  it("關係說成「主詞 關係 受詞」，同一方向的多種關係合併在同一句", () => {
    expect(relationSentences(full, neighbors[0].relations, "zh-TW")).toEqual(["林志明（產品研發部） 隸屬、負責 產品研發部"]);
    expect(relationSentences(full, neighbors[0].relations, "en")).toEqual(["Chih-ming Lin (R&D) Member of and Leads R&D"]);
  });

  it("方向相反的關係各說一句，主詞仍是關係的起點", () => {
    const back = relation("r9", "leads", "t1", "p1");
    expect(relationSentences({ ...full, relations: [...full.relations, back] }, [full.relations[0], back], "zh-TW")).toEqual([
      "林志明（產品研發部） 隸屬 產品研發部",
      "產品研發部 負責 林志明（產品研發部）",
    ]);
  });

  it("進入、移動、前往依規格的句型；同名實體用消歧名稱", () => {
    expect(announceEnter(full, "p1", NONE, "zh-TW")).toBe("知識圖譜，5 個實體、5 段關係。目前：林志明（產品研發部），人員，關聯 4。");
    expect(announceMove(full, neighbors, 1, "zh-TW")).toBe("2／3：長堤專案。林志明（產品研發部） 參與 長堤專案。");
    expect(announceGo(full, "p2", "zh-TW")).toBe("前往 林志明（業務部），人員，關聯 1。");
    expect(announceEnter(full, "p1", NONE, "en")).toBe("Knowledge graph, 5 entities, 5 relations. Current: Chih-ming Lin (R&D), Person, 4 relations.");
    expect(announceGo(full, "p2", "en")).toBe("Going to Chih-ming Lin (Sales), Person, 1 relation.");
  });

  it("數量只算目前身分看得到的，不提及看不到的部分（#247）", () => {
    const sentence = announceEnter(limited, "p1", NONE, "zh-TW");
    expect(sentence).toBe("知識圖譜，4 個實體、4 段關係。目前：林志明（產品研發部），人員，關聯 3。");
    expect(sentence).not.toContain("長堤");
    const moves = neighborsClockwise(limited, "p1", positions, NONE).map((_, i, list) => announceMove(limited, list, i, "zh-TW"));
    expect(moves.join("")).not.toContain("長堤");
    expect(moves[0]).toMatch(/^1／2：/);
  });

  it("篩選後說顯示的實體數", () => {
    expect(announceShown(full, new Set(["j1"]), "zh-TW")).toBe("顯示 4 個實體。");
    expect(announceShown(full, new Set(["p1", "p2", "j1"]), "en")).toBe("Showing 2 entities.");
  });
});

describe("報讀的去抖（#289）", () => {
  it("連續呼叫只在最後一次之後 200ms 寫入一次", () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn();
      const announcer = createAnnouncer(write);
      announcer.say("一");
      vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS - 1);
      announcer.say("二");
      vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS - 1);
      expect(write).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith("二");
      announcer.say("三");
      announcer.cancel();
      vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
