// 上傳後的萃取狀態（#44）：萃取中（第幾批）、已送審的筆數、捨棄的筆數、未萃取的段落、失敗時可以重試。
import type { ExtractionState } from "../extraction/run";
import { errorMessage, strings, type ExtractFailure } from "./strings";

interface Props {
  state: ExtractionState;
  language: string;
  onRetry(): void;
}

const EXTRACT_FAILURES = new Set<string>(["format", "truncated", "write", "no_access_code"]);

export function ExtractionStatus({ state, language, onRetry }: Props) {
  const s = strings(language);
  const total = state.batches.length;
  const done = state.batches.filter((b) => b.status === "done").length;
  const running = state.batches.findIndex((b) => b.status === "running");
  const failed = state.batches.filter((b) => b.status === "failed");
  const waiting = state.batches.some((b) => b.status === "waiting");
  const sum = (key: "entities" | "relations" | "dropped") => state.batches.reduce((n, b) => n + b[key], 0);
  const message = (error: string) => (EXTRACT_FAILURES.has(error) ? s.extractErrors[error as ExtractFailure] : errorMessage(language, error));
  // 失敗的原因不重複列出
  const reasons = [...new Set(failed.map((b) => b.error ?? "failed"))];

  return (
    <div className="extraction" aria-live="polite">
      <h3>{s.extractTitle}</h3>
      {running >= 0 && (
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
      {failed.length > 0 && running < 0 && (
        <div>
          <p className="error">
            {s.extractFailed}
            {s.colon}
            {reasons.map(message).join(" ")}
          </p>
          <button type="button" onClick={onRetry}>
            {s.extractRetry}
          </button>
        </div>
      )}
      {failed.length === 0 && waiting && running < 0 && (
        <button type="button" onClick={onRetry}>
          {s.extractRetry}
        </button>
      )}
    </div>
  );
}
