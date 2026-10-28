// 進行中的提問：同時只有一個有效。新的提問或切換身分、語言時，舊的提問被捨棄（取消連線，之後的 onText 與結果都忽略）。
export interface Ticket {
  signal: AbortSignal;
  // 這次提問是否仍是目前有效的提問
  isCurrent(): boolean;
}

export function createRequestGate() {
  let current: { id: number; controller: AbortController } | null = null;
  let next = 0;

  return {
    begin(): Ticket {
      current?.controller.abort();
      const entry = { id: ++next, controller: new AbortController() };
      current = entry;
      return { signal: entry.controller.signal, isCurrent: () => current?.id === entry.id };
    },
    cancel(): void {
      current?.controller.abort();
      current = null;
    },
  };
}
