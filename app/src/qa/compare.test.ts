import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { strings } from "../client/i18n";
import type { RetrievedPassage, Retriever } from "../retrieval/retrieve";
import type { QaContext } from "./answer";
import { askEach, canStartCompare } from "./compare";
import { answered, fakeTransport } from "./testing";
import type { AskBody, AskEvent } from "./types";

const IDENTITIES = ["guest", "staff", "manager"];
const Q = { text: "到職滿一年有幾天年假？", language: "zh-TW" } as const;

// 每個身分各有一段只屬於自己的段落；記錄檢索時的身分
function recordingRetriever(visible: (id: string | null) => boolean = () => true) {
  const calls: (string | null)[] = [];
  const retriever: Retriever = {
    async retrieve(identityId) {
      calls.push(identityId);
      if (!visible(identityId)) return [];
      const passage: RetrievedPassage = {
        id: `p-${identityId}`,
        documentId: `d-${identityId}`,
        documentTitle: `title-${identityId}`,
        documentDate: null,
        language: "zh-TW",
        content: `content-${identityId}`,
        score: 1,
        supersededBy: null,
      };
      return [passage];
    },
  };
  return { retriever, calls };
}

const context = (retriever: Retriever, reply?: (body: AskBody) => AskEvent[]) => {
  const transport = fakeTransport(reply);
  const ctx: QaContext = { retriever, transport, model: clientConfig.client.model, displayName: clientConfig.client.displayName };
  return { ctx, transport };
};

describe("askEach", () => {
  it("依身分順序一欄一欄以該身分檢索與送出，送出次數等於身分數", async () => {
    const { retriever, calls } = recordingRetriever();
    const { ctx, transport } = context(retriever, () => answered("答案 [1]。"));
    const order: number[] = [];
    const answers = await askEach(ctx, IDENTITIES, Q, { onAnswer: (i) => order.push(i) });
    expect(calls).toEqual(IDENTITIES);
    expect(order).toEqual([0, 1, 2]);
    expect(transport.bodies).toHaveLength(IDENTITIES.length);
    // 每次送出只有該欄身分的段落，不混入其他欄的檢索結果
    transport.bodies.forEach((body, i) => {
      const content = body.messages[0].content;
      for (const id of IDENTITIES) expect(content.includes(`content-${id}`), `${i} ${id}`).toBe(id === IDENTITIES[i]);
    });
    answers.forEach((a, i) => {
      expect(a.kind).toBe("answer");
      if (a.kind === "answer") expect(a.cited).toEqual([`p-${IDENTITIES[i]}`]);
    });
  });

  it("沒有段落的欄與一般拒答相同（本機拒答，不送出）", async () => {
    const { retriever } = recordingRetriever((id) => id === "manager");
    const { ctx, transport } = context(retriever);
    const answers = await askEach(ctx, IDENTITIES, Q);
    const refusal = { kind: "refusal", text: strings("zh-TW").refusal };
    expect(answers).toEqual([refusal, refusal, expect.objectContaining({ kind: "answer" })]);
    expect(transport.bodies).toHaveLength(1);
  });

  it("onText 帶著欄的位置", async () => {
    const { retriever } = recordingRetriever();
    const { ctx } = context(retriever, (body) => answered(body.messages[0].content.includes("content-staff") ? "員工 [1]" : "其他 [1]"));
    const texts: [number, string][] = [];
    await askEach(ctx, IDENTITIES, Q, { onText: (i, t) => texts.push([i, t]) });
    expect(texts.filter(([i]) => i === 1).at(-1)?.[1]).toBe("員工 [1]");
    expect(new Set(texts.map(([i]) => i))).toEqual(new Set([0, 1, 2]));
  });

  for (const error of ["daily_limit", "global_daily_limit"]) {
    it(`中途收到 ${error} 時，已完成的欄保留，之後的欄顯示額度錯誤、不再送出`, async () => {
      const { retriever, calls } = recordingRetriever();
      let sent = 0;
      const { ctx, transport } = context(retriever, () => (++sent === 2 ? [{ type: "error", error }] : answered("答案 [1]")));
      const answers = await askEach(ctx, IDENTITIES, Q);
      expect(answers.map((a) => a.kind)).toEqual(["answer", "error", "error"]);
      expect(answers.slice(1)).toEqual([{ kind: "error", error }, { kind: "error", error }]);
      expect(transport.bodies).toHaveLength(2);
      expect(calls).toEqual(["guest", "staff"]);
    });
  }

  it("其他錯誤不影響之後的欄", async () => {
    const { retriever } = recordingRetriever();
    let sent = 0;
    const { ctx, transport } = context(retriever, () => (++sent === 1 ? [{ type: "error", error: "upstream_overloaded" }] : answered("答案 [1]")));
    const answers = await askEach(ctx, IDENTITIES, Q);
    expect(answers.map((a) => a.kind)).toEqual(["error", "answer", "answer"]);
    expect(transport.bodies).toHaveLength(3);
  });

  it("中止後（切換題目、關閉對照）不再送出，也不再呼叫 callbacks", async () => {
    const { retriever } = recordingRetriever();
    const { ctx, transport } = context(retriever, () => answered("答案 [1]"));
    const controller = new AbortController();
    const seen: number[] = [];
    const answers = await askEach(
      ctx,
      IDENTITIES,
      Q,
      {
        onText: (i) => seen.push(i),
        onAnswer: (i) => {
          seen.push(i);
          if (i === 0) controller.abort();
        },
      },
      controller.signal,
    );
    expect(answers).toHaveLength(1);
    expect(transport.bodies).toHaveLength(1);
    expect(seen.every((i) => i === 0)).toBe(true);
  });

  it("一開始就中止時什麼都不送出", async () => {
    const { retriever, calls } = recordingRetriever();
    const { ctx, transport } = context(retriever);
    const controller = new AbortController();
    controller.abort();
    expect(await askEach(ctx, IDENTITIES, Q, {}, controller.signal)).toEqual([]);
    expect(calls).toEqual([]);
    expect(transport.bodies).toEqual([]);
  });
});

describe("canStartCompare", () => {
  it("已收到今天用完了時不送出；其他情況照常送出（前端不知道剩餘次數）", () => {
    expect(canStartCompare(null)).toBe(true);
    expect(canStartCompare("daily_limit")).toBe(false);
    expect(canStartCompare("global_daily_limit")).toBe(false);
  });
});
