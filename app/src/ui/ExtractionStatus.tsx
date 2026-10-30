// 上傳後的萃取狀態（#44）：萃取中（第幾批）、已送審的筆數、捨棄的筆數、未萃取的段落、失敗時可以重試。
import type { ExtractionState } from "../extraction/run";
import { Notice } from "./Notice";
import { strings, taskErrorMessage } from "./strings";

interface Props {
  state: ExtractionState;
  // 萃取實際在執行中（App 的執行紀錄）；停止後仍是 waiting 的批次顯示為「未執行，可重試」
  running: boolean;
  language: string;
  onRetry(): void;
}

export function ExtractionStatus({ state, running: active, language, onRetry }: Props) {
  const s = strings(language);
  const total = state.batches.length;
  const done = state.batches.filter((b) => b.status === "done").length;
  const running = state.batches.findIndex((b) => b.status === "running");
  const failed = state.batches.filter((b) => b.status === "failed");
  const notRun = active ? 0 : state.batches.filter((b) => b.status === "waiting").length;
  const sum = (key: "entities" | "relations" | "dropped") => state.batches.reduce((n, b) => n + b[key], 0);
  const message = (error: string) => taskErrorMessage(language, error);
  // 失敗的原因不重複列出
  const reasons = [...new Set(failed.map((b) => b.error ?? "failed"))];

  return (
    <div className="extraction" aria-live="polite">
      <h3>{s.extractTitle}</h3>
      {active && running >= 0 && (
        <p className="muted">
          {s.extractRunning} {running + 1}／{total}
        </p>
      )}
      <p>
        {s.extractDone}
        {s.colon}
        {s.extractEntities} {sum("entities")}
        {s.listSeparator}
        {s.extractRelations} {sum("relations")}
        {s.listSeparator}
        {s.extractDropped} {sum("dropped")}
        <span className="muted">
          {" · "}
          {done}／{total}
        </span>
      </p>
      {state.skipped.length > 0 && (
        <p className="muted">
          {s.extractSkipped}
          {s.colon}
          {state.skipped.length}
        </p>
      )}
      {/* 重試會一併送出失敗與未執行的批次；已成功的批次不重送 */}
      {!active && failed.length > 0 && (
        <Notice kind="error" title={s.extractFailed} action={{ label: s.extractRetry, onClick: onRetry }}>
          {reasons.map(message).join(" ")}
          {notRun > 0 && (
            <div>
              {s.extractNotRun}
              {s.colon}
              {notRun}
            </div>
          )}
        </Notice>
      )}
      {!active && failed.length === 0 && notRun > 0 && (
        <Notice kind="info" title={s.extractNotRun} action={{ label: s.extractRetry, onClick: onRetry }}>
          {notRun}
        </Notice>
      )}
    </div>
  );
}
