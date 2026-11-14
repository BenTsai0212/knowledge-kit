// 上傳後的萃取狀態（#44）：萃取中（第幾批）、已送審的筆數、捨棄的筆數、未萃取的段落、失敗時可以重試。
// 設計系統 v1（#242）：每批一格，依真實進度填滿（linear）；實體數與關係數改變時以 settle 彈出；
// 失敗時在原地換成說明與「重試」，已完成的批次保留。顯示時已有的結果不重播。
import { useRef, type CSSProperties } from "react";
import type { ExtractionState } from "../extraction/run";
import { Notice } from "./Notice";
import { fill, strings, taskErrorMessage } from "../client/i18n";

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
  const sum = (key: "entities" | "relations" | "dropped") => state.batches.reduce((n, b) => n + b[key], 0);
  // 顯示時已完成的批次與已有的數字不重播動畫
  const shown = useRef({ batches: new Set(state.batches.flatMap((b, i) => (b.status === "done" ? [i] : []))), entities: sum("entities"), relations: sum("relations") });
  const count = (key: "entities" | "relations", i: number) => {
    const n = sum(key);
    return (
      <span key={`${key}:${n}`} className={`extraction-count${n === shown.current[key] ? "" : " is-new"}`} style={{ "--i": i } as CSSProperties}>
        {n}
      </span>
    );
  };

  return (
    <div className="extraction" aria-live="polite">
      <h3>{s.extractTitle}</h3>
      {/* 批次格：文字的進度在下方，格子只是視覺 */}
      <ol className="extraction-batches" aria-hidden="true">
        {state.batches.map((b, i) => (
          <li key={i} className={`is-${b.status}`}>
            {b.status === "done" && <span className={`extraction-batch${shown.current.batches.has(i) ? " is-still" : ""}`} />}
          </li>
        ))}
      </ol>
      {active && running >= 0 && (
        <p className="muted">
          {s.extractRunning} {fill(s.progress, { done: running + 1, total })}
        </p>
      )}
      <p>
        {s.extractDone}
        {s.colon}
        {s.extractEntities} {count("entities", 0)}
        {s.listSeparator}
        {s.extractRelations} {count("relations", 1)}
        {s.listSeparator}
        {s.extractDropped} {sum("dropped")}
        <span className="muted">
          {" · "}
          {fill(s.progress, { done, total })}
        </span>
      </p>
      {state.skipped.length > 0 && (
        <p className="muted">
          {s.extractSkipped}
          {s.colon}
          {state.skipped.length}
        </p>
      )}
      {!active && <ExtractionFailure state={state} language={language} onRetry={onRetry} />}
    </div>
  );
}

// 萃取停止後的失敗與未執行的批次（桌機的上傳詳情只顯示這一段，#344 審查）。
// 重試會一併送出失敗與未執行的批次；已成功的批次不重送
export function ExtractionFailure({ state, language, onRetry }: { state: ExtractionState; language: string; onRetry(): void }) {
  const s = strings(language);
  const failed = state.batches.filter((b) => b.status === "failed");
  const notRun = state.batches.filter((b) => b.status === "waiting").length;
  // 失敗的原因不重複列出
  const reasons = [...new Set(failed.map((b) => taskErrorMessage(language, b.error ?? "failed")))];
  if (failed.length > 0)
    return (
      <Notice kind="error" title={s.extractFailed} action={{ label: s.extractRetry, onClick: onRetry }}>
        {reasons.join(" ")}
        {notRun > 0 && (
          <div>
            {s.extractNotRun}
            {s.colon}
            {notRun}
          </div>
        )}
      </Notice>
    );
  if (notRun > 0)
    return (
      <Notice kind="info" title={s.extractNotRun} action={{ label: s.extractRetry, onClick: onRetry }}>
        {notRun}
      </Notice>
    );
  return null;
}
