import { describe, expect, it } from "vitest";
import { parseSse } from "./sse";

const stream = (chunks: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? new TextEncoder().encode(c) : c);
      controller.close();
    },
  });

const collect = async (chunks: (string | Uint8Array)[]) => {
  const events = [];
  for await (const e of parseSse(stream(chunks))) events.push(e);
  return events;
};

describe("parseSse", () => {
  it("以空行分隔事件，取 event 與 data", async () => {
    expect(await collect(['event: delta\ndata: {"text":"a"}\n\nevent: done\ndata: {}\n\n'])).toEqual([
      { event: "delta", data: '{"text":"a"}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("事件跨 chunk、\\r\\n 跨 chunk、多行 data、注解行、沒有 event 時為 message", async () => {
    expect(await collect([": ping\r", "\n\r\nevent: de", "lta\r\ndata: a\r\ndata: b\r", "\n\r\ndata: x\n\n"])).toEqual([
      { event: "delta", data: "a\nb" },
      { event: "message", data: "x" },
    ]);
  });

  it("多位元組字元跨 chunk 時不會變成亂碼", async () => {
    const bytes = new TextEncoder().encode('data: {"text":"年假"}\n\n');
    expect(await collect([bytes.slice(0, 16), bytes.slice(16)])).toEqual([{ event: "message", data: '{"text":"年假"}' }]);
  });

  it("結尾沒有空行的事件不送出", async () => {
    expect(await collect(['event: delta\ndata: {"text":"a"}'])).toEqual([]);
  });
});
