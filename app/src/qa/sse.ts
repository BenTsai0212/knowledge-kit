// 解析 /api/ask 的 server-sent events：以空行分隔事件，取 event 與 data 欄位（多行 data 以換行合併），略過注解行。
// 與 worker/src/sse.ts 的規則相同；app 與 worker 的型別環境不同（DOM／workers-types），所以各自一份。
export interface SseEvent {
  event: string;
  data: string;
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 結尾的 \r 可能與下一段開頭的 \n 是同一個換行，先保留
      const cr = buffer.endsWith("\r");
      buffer = buffer.slice(0, cr ? -1 : undefined).replace(/\r\n?/g, "\n") + (cr ? "\r" : "");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = toEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event) yield event;
      }
    }
  } finally {
    // 提前結束（例如收到 done）時一併取消連線
    await reader.cancel().catch(() => {});
  }
}

function toEvent(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length > 0 ? { event, data: data.join("\n") } : null;
}
