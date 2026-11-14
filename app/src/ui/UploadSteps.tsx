// 上傳頁頁首的五個步驟（#242）：完成的步驟下方是 primary 細條，進行中的顯示真實數字（例如批次 2／3）。
// 步驟的狀態由 upload-helpers.ts 的 uploadSteps() 算出。
// 手機（compact，#282）縮成一條進度列（每步一段，填滿比例由 stepBar() 算出），下方一行寫目前步驟與真實批數
import type { CSSProperties } from "react";
import { fill, strings } from "../client/i18n";
import { stepBar, type UploadStep, type UploadStepDetail, type UploadStepName } from "./upload-helpers";

interface Props {
  steps: UploadStep[];
  language: string;
  compact?: boolean;
}

export function UploadSteps({ steps, language, compact = false }: Props) {
  const s = strings(language);
  const names: Record<UploadStepName, string> = {
    upload: s.uploadStepUpload,
    chunk: s.uploadStepChunk,
    extract: s.uploadStepExtract,
    review: s.uploadStepReview,
    merge: s.uploadStepMerge,
  };
  const detail = (d: UploadStepDetail) =>
    d.kind === "passages"
      ? fill(s.uploadStepPassages, { count: d.count })
      : d.kind === "batch"
        ? fill(s.uploadStepBatch, { done: d.done, total: d.total })
        : fill(s.uploadStepSent, { count: d.count });
  if (compact) {
    const { fills, current } = stepBar(steps);
    return (
      <div className="upload-bar">
        <ol className="upload-bar__segments" aria-label={s.uploadStepsLabel}>
          {steps.map((step, i) => (
            <li
              key={step.name}
              data-step={step.name}
              className={`upload-bar__segment is-${step.status}`}
              style={{ "--fill": fills[i] } as CSSProperties}
              aria-current={step.status === "active" ? "step" : undefined}
            >
              <span className="visually-hidden">{names[step.name]}</span>
            </li>
          ))}
        </ol>
        <p className="upload-bar__current">
          {current.detail === undefined ? names[current.name] : fill(s.uploadStepCurrent, { step: names[current.name], detail: detail(current.detail) })}
        </p>
      </div>
    );
  }
  return (
    <ol className="upload-steps" aria-label={s.uploadStepsLabel}>
      {steps.map((step) => (
        <li key={step.name} data-step={step.name} className={`upload-step is-${step.status}`} aria-current={step.status === "active" ? "step" : undefined}>
          <span className="upload-step__name">{names[step.name]}</span>
          {step.detail !== undefined && <span className="upload-step__detail">{detail(step.detail)}</span>}
        </li>
      ))}
    </ol>
  );
}
