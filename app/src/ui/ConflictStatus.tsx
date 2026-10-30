// 上傳後的比對狀態（#51，docs/conflicts.md「畫面」）：等待萃取完成、比對中、找到幾組、未比對的段落、失敗時可以重試。
import type { ConflictState } from "../conflicts/run";
import { Notice } from "./Notice";
import { strings, taskErrorMessage } from "./strings";

interface Props {
  // 還沒開始（萃取還沒結束）時為 undefined
  state: ConflictState | undefined;
  // 比對實際在執行中（App 的執行紀錄）
  running: boolean;
  language: string;
  onRetry(): void;
}

export function ConflictStatus({ state, running, language, onRetry }: Props) {
  const s = strings(language);
  const count = (label: string, n: number) => (
    <p className="muted">
      {label}
      {s.colon}
      {n}
    </p>
  );

  return (
    <div className="extraction" aria-live="polite">
      <h3>{s.conflictTitle}</h3>
      {state === undefined ? (
        !running && <p className="muted">{s.conflictWaiting}</p>
      ) : (
        <>
          {(running || state.status === "running") && <p className="muted">{s.conflictRunning}</p>}
          {state.status === "done" && (
            <p>
              {s.conflictFound}
              {s.colon}
              {state.found}
              {state.dropped > 0 && (
                <span className="muted">
                  {s.listSeparator}
                  {s.conflictDropped} {state.dropped}
                </span>
              )}
            </p>
          )}
          {state.selection.unchecked.length > 0 && count(s.conflictUnchecked, state.selection.unchecked.length)}
          {state.selection.unrelated.length > 0 && count(s.conflictUnrelated, state.selection.unrelated.length)}
          {/* 重試只重送比對這一次呼叫，送出相同的內容 */}
          {!running && state.status === "failed" && (
            <Notice kind="error" title={s.conflictFailed} action={{ label: s.conflictRetry, onClick: onRetry }}>
              {taskErrorMessage(language, state.error ?? "failed")}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
