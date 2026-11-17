// 首頁「以前答不出來，現在可能答得出來了」的判斷規則（#408）。以假的檢索函式驗證規則；
// 實際的 retrieve()（minScore、RLS）與快取鍵的資料庫查詢在 app/tests/retrieval/recheck.test.ts
import { describe, expect, it } from "vitest";
import {
  acknowledge,
  latestMaybeAnswerable,
  recheckKey,
  recheckRefused,
  rememberOutcome,
  rememberQuestion,
  type AskedQuestion,
  type MaybeAnswerable,
  type Recheck,
} from "./home";

const AT = "2026-11-10T09:00:00.000Z";
const passage = (id: string, score: number, documentId = `doc-${id}`) => ({ id, documentId, documentTitle: `標題 ${documentId}`, score });
const refused = (question: string, seen: string[], at = AT): AskedQuestion => ({ question, at, refused: true, seen });

// 假的檢索：問題 → 結果；記下查過的問題
function fake(results: Record<string, ReturnType<typeof passage>[]>) {
  const calls: string[] = [];
  const retrieve: Recheck = async (q) => (calls.push(q), results[q] ?? []);
  return { retrieve, calls };
}

describe("rememberOutcome", () => {
  it("被拒答時記下這次檢索到的 id（換掉舊的），得到回答時不再是拒答", () => {
    const asked = rememberQuestion([], "a", AT);
    const once = rememberOutcome(asked, "a", { refused: true, retrieved: ["p1"] });
    expect(once).toEqual([refused("a", ["p1"])]);
    expect(rememberOutcome(once, "a", { refused: true, retrieved: ["p2"] })).toEqual([refused("a", ["p2"])]);
    expect(rememberOutcome(once, "a", { refused: false })).toEqual([{ question: "a", at: AT, refused: false, seen: [] }]);
  });

  it("其他題目不受影響", () => {
    const asked = [refused("a", ["p1"]), refused("b", [])];
    expect(rememberOutcome(asked, "b", { refused: false })[0]).toBe(asked[0]);
  });
});

describe("recheckRefused", () => {
  it("出現 seen 以外的段落才算：帶來變化的文件是分數最高的新段落所屬的文件", async () => {
    const { retrieve } = fake({ a: [passage("old", 0.9), passage("new1", 0.5, "d1"), passage("new2", 0.7, "d2")] });
    expect(await recheckRefused([refused("a", ["old"])], retrieve)).toEqual<MaybeAnswerable[]>([
      { question: "a", at: AT, document: { id: "d2", title: "標題 d2" }, retrieved: ["old", "new1", "new2"] },
    ]);
  });

  it("只有舊段落、或沒有任何段落時不算", async () => {
    const { retrieve } = fake({ a: [passage("old", 0.9)], b: [] });
    expect(await recheckRefused([refused("a", ["old"]), refused("b", [])], retrieve)).toEqual([]);
  });

  it("當時沒有任何段落（本機拒答）、現在有了就算", async () => {
    const { retrieve } = fake({ a: [passage("p1", 0.4)] });
    expect((await recheckRefused([refused("a", [])], retrieve)).map((x) => x.document.id)).toEqual(["doc-p1"]);
  });

  it("只查被拒答的題目；已回答的不查", async () => {
    const { retrieve, calls } = fake({ a: [passage("p1", 0.9)], b: [passage("p2", 0.9)] });
    const asked: AskedQuestion[] = [refused("a", []), { question: "b", at: AT, refused: false, seen: [] }];
    expect((await recheckRefused(asked, retrieve)).map((x) => x.question)).toEqual(["a"]);
    expect(calls).toEqual(["a"]);
  });

  it("中止後不再查下一題", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const retrieve: Recheck = async (q) => (calls.push(q), controller.abort(), [passage("p1", 0.9)]);
    await recheckRefused([refused("a", []), refused("b", [])], retrieve, controller.signal);
    expect(calls).toEqual(["a"]);
  });
});

describe("acknowledge（知道了）", () => {
  it("這次檢索到的 id 併入 seen：之後同樣的結果不再提示，又有新的段落時再提示", async () => {
    const results: Record<string, ReturnType<typeof passage>[]> = { a: [passage("old", 0.9), passage("new1", 0.8, "d1")] };
    const { retrieve } = fake(results);
    let asked = [refused("a", ["old"])];
    const [found] = await recheckRefused(asked, retrieve);
    asked = acknowledge(asked, "a", found.retrieved);
    expect(asked[0].seen).toEqual(["old", "new1"]);
    expect(await recheckRefused(asked, retrieve)).toEqual([]);

    results.a = [...results.a, passage("new2", 0.6, "d2")];
    expect((await recheckRefused(asked, retrieve)).map((x) => x.document.id)).toEqual(["d2"]);
  });

  it("仍是拒答，再問一次的結果照常記錄", () => {
    const asked = acknowledge([refused("a", ["p1"])], "a", ["p1", "p2"]);
    expect(asked).toEqual([refused("a", ["p1", "p2"])]);
  });
});

describe("latestMaybeAnswerable", () => {
  const item = (question: string, at: string): MaybeAnswerable => ({ question, at, document: { id: "d", title: "t" }, retrieved: [] });

  it("取提問時間最新的一題；沒有時為 null", () => {
    expect(latestMaybeAnswerable([])).toBeNull();
    expect(latestMaybeAnswerable([item("a", "2026-11-01T00:00:00Z"), item("b", "2026-11-03T00:00:00Z"), item("c", "2026-11-02T00:00:00Z")])?.question).toBe("b");
  });
});

describe("recheckKey（快取鍵）", () => {
  it("資料與被拒答的題目都沒變時相同；已回答的題目與提問時間不影響", () => {
    const asked = [refused("a", ["p2", "p1"]), { question: "b", at: AT, refused: false, seen: [] }];
    const key = recheckKey("3:x", asked);
    expect(recheckKey("3:x", [refused("a", ["p1", "p2"], "2026-11-11T00:00:00Z")])).toBe(key);
  });

  it("看得到的段落、新的拒答或「知道了」改變時不同", () => {
    const asked = [refused("a", ["p1"])];
    const key = recheckKey("3:x", asked);
    expect(recheckKey("3:y", asked)).not.toBe(key);
    expect(recheckKey("3:x", [...asked, refused("b", [])])).not.toBe(key);
    expect(recheckKey("3:x", acknowledge(asked, "a", ["p1", "p9"]))).not.toBe(key);
  });
});
