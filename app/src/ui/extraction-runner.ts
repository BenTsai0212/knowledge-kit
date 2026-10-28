// 背景萃取的執行紀錄（#44，#47 審查）：同一份文件同時只執行一個；「萃取中」依實際執行中的工作判斷，
// 不看批次狀態（邀請碼被拒而停止時，後面的批次仍是 waiting，但萃取已經不在執行）。
export interface ExtractionRunner {
  // 已在執行時不重複執行，回傳 undefined
  run<T>(documentId: string, task: () => Promise<T>): Promise<T | undefined>;
  isRunning(documentId: string): boolean;
}

// onChange 收到目前執行中的文件 id（新的 Set），供 App 反映到 state
export function createExtractionRunner(onChange: (running: ReadonlySet<string>) => void = () => {}): ExtractionRunner {
  const running = new Set<string>();
  return {
    async run(documentId, task) {
      if (running.has(documentId)) return undefined;
      running.add(documentId);
      onChange(new Set(running));
      try {
        return await task();
      } finally {
        running.delete(documentId);
        onChange(new Set(running));
      }
    },
    isRunning: (documentId) => running.has(documentId),
  };
}
