// 假的 /api/ask（#66）：以 page.route 攔下請求，依 system 的開頭分辨問答、萃取、比對與評分，回傳最小的合法回應。
// 格式見 worker/README.md：N 個 delta 事件，最後一個 done。不使用真實金鑰、不啟動 Worker。
import type { Page } from "@playwright/test";
import { client, knowledgeModel } from "./client";

// 萃取時回傳的實體（虛構）：類型是 knowledge-model.json 的第一個，每種語言用同一個名稱；待審頁以此找到上傳後的待審項目
export const FAKE_ENTITY_NAME = "E2E Tester";
const FAKE_ENTITY_NAMES = Object.fromEntries(client.languages.map((l) => [l, FAKE_ENTITY_NAME]));
// 問答的回答：引用 prompt 中的第 1 段，通過 citations.ts 的引用解析
export const FAKE_ANSWER_LEAD = "這是測試用的回答";
const FAKE_ANSWER = `${FAKE_ANSWER_LEAD} [1]。`;

interface AskBody {
  system?: string;
  messages?: { content: string }[];
}

// 依 system 的開頭（app/src 中各 prompt 的第一句）決定回應的文字；不認得的請求回 null
export function fakeReply(body: AskBody): string | null {
  const system = body.system ?? "";
  if (system.startsWith("You answer questions")) return FAKE_ANSWER;
  if (system.startsWith("You extract entities")) {
    return JSON.stringify({
      entities: [{ key: "e1", type: knowledgeModel.entityTypes[0].id, names: FAKE_ENTITY_NAMES, sources: [1] }],
      relations: [],
    });
  }
  if (system.startsWith("You compare a newly uploaded document")) return JSON.stringify({ conflicts: [] });
  if (system.startsWith("You grade an answer")) return JSON.stringify({ verdict: "correct", reason: "fake grade" });
  return null;
}

export const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

// 回答分成兩段 delta，確認前端會依序串接
export function sseBody(text: string): string {
  const half = Math.ceil(text.length / 2);
  return [text.slice(0, half), text.slice(half)].map((t) => event("delta", { text: t })).join("") + event("done", { stopReason: "end_turn" });
}

// 不認得的請求回 Worker 的錯誤格式，畫面顯示錯誤，測試因而失敗，不會默默通過
export async function routeFakeAsk(page: Page): Promise<void> {
  await page.route("**/api/ask", async (route) => {
    const text = fakeReply(route.request().postDataJSON() as AskBody);
    if (text === null) {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_request" }) });
      return;
    }
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(text) });
  });
}

// 串流到一半的回答（越權測試「串流中切換身分」）：route.fulfill 一次送出整個 body，做不出串流中的狀態，
// 所以在頁面內替換 fetch，/api/ask 回一個由測試逐段送出的 ReadableStream。須在 page.goto 之前呼叫
interface HeldStream {
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  cancelled: boolean;
}
type HeldWindow = Window & { __e2eAsk?: HeldStream };

export async function holdAskStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as HeldWindow;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/api/ask")) return original(input, init);
      const held: HeldStream = { controller: null, cancelled: false };
      w.__e2eAsk = held;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => void (held.controller = controller),
        cancel: () => void (held.cancelled = true),
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    };
  });
}

// 已送出 /api/ask，串流開著
export const askStreamOpen = (page: Page) => page.evaluate(() => (window as HeldWindow).__e2eAsk?.controller != null);
// 前端已取消讀取（捨棄或讀完後都會取消）
export const askStreamCancelled = (page: Page) => page.evaluate(() => (window as HeldWindow).__e2eAsk?.cancelled === true);

// 送出一段 SSE；串流已被取消時忽略
export async function pushAskStream(page: Page, chunk: string): Promise<void> {
  await page.evaluate((text) => {
    try {
      (window as HeldWindow).__e2eAsk?.controller?.enqueue(new TextEncoder().encode(text));
    } catch {
      // 已取消的串流不能再寫入
    }
  }, chunk);
}
