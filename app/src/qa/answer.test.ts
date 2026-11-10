import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import { seedDataset } from "../dataset/seed";
import { openDatabase, type Database } from "../db/database";
import { openRetriever, type Retriever } from "../retrieval/retrieve";
import { strings } from "../client/i18n";
import { ask, type QaContext } from "./answer";
import { escapeText, MAX_QUESTION_CHARS, REFUSAL_MARKER } from "./prompt";
import { answered, fakeTransport } from "./testing";
import type { AskEvent } from "./types";

let db: Database;
let retriever: Retriever;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) });
  retriever = openRetriever(db, clientConfig.client.retrieval);
});
afterAll(async () => {
  await db.close();
});

const context = (reply?: () => AskEvent[]) => {
  const transport = fakeTransport(reply);
  const ctx: QaContext = { retriever, transport, model: clientConfig.client.model, displayName: clientConfig.client.displayName };
  return { ctx, transport };
};
const LEAVE = { identityId: "staff", text: "到職滿一年有幾天年假？", language: "zh-TW" };
const passages = Object.values(dataset.documents).flatMap((d) =>
  d.passages.map((p) => ({ id: p.id, text: p.text, title: d.title, language: p.language ?? d.language })),
);

describe("ask：流程", () => {
  it("以檢索到的段落組 prompt，送出 client.json 的模型代號與一則 user 訊息", async () => {
    const { ctx, transport } = context(() => answered("一年有 7 天 [1]。"));
    const answer = await ask(ctx, LEAVE);
    expect(transport.bodies).toHaveLength(1);
    const [body] = transport.bodies;
    expect(body.model).toBe(clientConfig.client.model);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.system).toContain("You answer questions for 範例公司");
    expect(body.messages[0].content).toContain("<question>\n到職滿一年有幾天年假？\n</question>");
    expect(answer).toMatchObject({ kind: "answer", text: "一年有 7 天 [1]。", cited: ["employee-handbook-zh-03"], uncited: false, incomplete: false });
  });

  it("onText 收到到目前為止的全部文字", async () => {
    const { ctx } = context(() => answered("一年", "有 7 天", " [1]。"));
    const seen: string[] = [];
    await ask(ctx, LEAVE, (text) => seen.push(text));
    expect(seen).toEqual(["一年", "一年有 7 天", "一年有 7 天 [1]。"]);
  });

  it("回答語言依介面語言", async () => {
    const { ctx, transport } = context();
    await ask(ctx, { ...LEAVE, language: "en" });
    expect(transport.bodies[0].system).toContain("Answer in English");
    expect(transport.bodies[0].system).toContain("You answer questions for Example Co.");
  });

  it("問題空白或太長時不檢索、不呼叫 /api/ask", async () => {
    const { ctx, transport } = context();
    expect(await ask(ctx, { ...LEAVE, text: "  " })).toEqual({ kind: "error", error: "empty_question" });
    expect(await ask(ctx, { ...LEAVE, text: "年".repeat(MAX_QUESTION_CHARS + 1) })).toEqual({ kind: "error", error: "question_too_long" });
    expect(transport.bodies).toEqual([]);
  });
});

describe("ask：拒答", () => {
  const refusal = { kind: "refusal", text: strings("zh-TW").refusal };

  it("檢索沒有結果時在本機拒答，不呼叫 /api/ask", async () => {
    const { ctx, transport } = context();
    expect(await ask(ctx, { ...LEAVE, text: "xyzzy" })).toEqual(refusal);
    expect(await ask(ctx, { ...LEAVE, identityId: null })).toEqual(refusal);
    expect(await ask(ctx, { ...LEAVE, identityId: "nobody" })).toEqual(refusal);
    expect(transport.bodies).toEqual([]);
  });

  it("模型輸出拒答標記時回固定的拒答文字，標記不會出現在畫面上", async () => {
    for (const deltas of [[REFUSAL_MARKER], ["[[NO_", "ANSWER]]"], ["  ", REFUSAL_MARKER, "\n補充說明"], ["一年有 7 天。", REFUSAL_MARKER]]) {
      const { ctx } = context(() => answered(...deltas));
      const seen: string[] = [];
      expect(await ask(ctx, LEAVE, (text) => seen.push(text)), deltas.join("|")).toEqual(refusal);
      expect(seen.some((text) => text.includes("[[")), deltas.join("|")).toBe(false);
    }
  });

  it("沒有資料與沒有權限的拒答完全相同：一般員工問調薪、主管問題庫外的問題", async () => {
    const { ctx } = context(() => answered(REFUSAL_MARKER));
    const noPermission = await ask(ctx, { identityId: "staff", text: "2026 年平均調薪幅度是多少？", language: "zh-TW" });
    const noData = await ask(ctx, { identityId: "manager", text: "公司的停車位怎麼申請？", language: "zh-TW" });
    const local = await ask(ctx, { identityId: "guest", text: "xyzzy", language: "zh-TW" });
    expect(noPermission).toEqual(refusal);
    expect(noData).toEqual(noPermission);
    expect(local).toEqual(noPermission);
  });

  it("拒答文字依介面語言", async () => {
    const { ctx } = context(() => answered(REFUSAL_MARKER));
    expect(await ask(ctx, { ...LEAVE, language: "en" })).toEqual({ kind: "refusal", text: strings("en").refusal });
  });

  it("模型沒有輸出任何文字時視為拒答", async () => {
    const { ctx } = context(() => answered());
    expect(await ask(ctx, LEAVE)).toEqual(refusal);
  });
});

describe("ask：引用", () => {
  it("不存在的編號移除並記錄", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx } = context(() => answered("一年有 7 天 [1][8]。"));
    expect(await ask(ctx, LEAVE)).toMatchObject({ text: "一年有 7 天 [1]。", dropped: [8], uncited: false });
    expect(warn).toHaveBeenCalledWith("回答引用了不存在的段落編號：8");
    warn.mockRestore();
  });

  it("沒有任何有效引用的回答標示未附出處", async () => {
    const { ctx } = context(() => answered("一年有 7 天。"));
    expect(await ask(ctx, LEAVE)).toMatchObject({ kind: "answer", cited: [], uncited: true });
  });

  it("numbering 對應到 prompt 中的段落編號", async () => {
    const { ctx, transport } = context();
    const answer = await ask(ctx, LEAVE);
    if (answer.kind !== "answer") throw new Error(answer.kind);
    const content = transport.bodies[0].messages[0].content;
    answer.numbering.forEach((id, i) => {
      const text = passages.find((p) => p.id === id)!.text;
      expect(content).toContain(`<passage number="${i + 1}" `);
      expect(content.split(`<passage number="${i + 1}" `)[1].split("</passage>")[0]).toContain(escapeText(text));
    });
  });
});

describe("ask：錯誤與串流中斷", () => {
  it("還沒收到內容就失敗時回錯誤類型", async () => {
    const { ctx } = context(() => [{ type: "error", error: "daily_limit" }]);
    expect(await ask(ctx, LEAVE)).toEqual({ kind: "error", error: "daily_limit" });
  });

  it("串流中斷時保留已收到的內容並標示不完整", async () => {
    const { ctx } = context(() => [{ type: "delta", text: "一年有 7 天 [1]" }, { type: "error", error: "upstream_overloaded" }]);
    expect(await ask(ctx, LEAVE)).toMatchObject({ kind: "answer", text: "一年有 7 天 [1]", incomplete: true, error: "upstream_overloaded" });
  });

  it("沒有 done 就結束的串流視為中斷", async () => {
    const { ctx } = context(() => [{ type: "delta", text: "一年有" }]);
    expect(await ask(ctx, LEAVE)).toMatchObject({ kind: "answer", text: "一年有", incomplete: true, error: "upstream_interrupted" });
  });

  it("只收到拒答標記的開頭就中斷時不顯示該片段", async () => {
    const { ctx } = context(() => [{ type: "delta", text: "[[NO_" }, { type: "error", error: "upstream_interrupted" }]);
    expect(await ask(ctx, LEAVE)).toEqual({ kind: "error", error: "upstream_interrupted" });
  });

  it("因 max_tokens 截斷時標示不完整", async () => {
    const { ctx } = context(() => [{ type: "delta", text: "一年有 7 天 [1]" }, { type: "done", stopReason: "max_tokens" }]);
    const answer = await ask(ctx, LEAVE);
    expect(answer).toMatchObject({ kind: "answer", incomplete: true });
    expect(answer).not.toHaveProperty("error");
  });
});

describe("ask：中止", () => {
  it("中止後不再呼叫 onText，signal 傳給傳輸層", async () => {
    const controller = new AbortController();
    const { ctx } = context(() => answered("一年", "有 7 天", " [1]。"));
    const send = ctx.transport.send.bind(ctx.transport);
    let received: AbortSignal | undefined;
    ctx.transport.send = (body, signal) => ((received = signal), send(body, signal));
    const seen: string[] = [];
    await ask(ctx, LEAVE, (text) => (seen.push(text), controller.abort()), controller.signal);
    expect(received).toBe(controller.signal);
    expect(seen).toEqual(["一年"]);
  });
});

describe("ask：說法不同", () => {
  const launch = clientConfig.scenarios.scenarios.flatMap((s) => s.questions).find((q) => q.id === "bluewing-launch")!;

  it.each(clientConfig.client.languages)("青翼桌上市時間（%s）：兩種說法都送出，且分屬不同的文件標題", async (language) => {
    const { ctx, transport } = context();
    await ask(ctx, { identityId: "staff", text: launch.text[language], language });
    const { system, messages } = transport.bodies[0];
    const same = launch.answerPassages.map((id) => passages.find((p) => p.id === id)!).filter((p) => p.language === language);
    expect(same).toHaveLength(2);
    for (const p of same) {
      expect(messages[0].content).toContain(escapeText(p.text));
      expect(messages[0].content).toContain(`title="${escapeText(p.title)}"`);
    }
    expect(new Set(same.map((p) => p.title)).size).toBe(2);
    expect(system).toContain("State each claim with its document title and citation, then say that the sources disagree.");
  });
});
