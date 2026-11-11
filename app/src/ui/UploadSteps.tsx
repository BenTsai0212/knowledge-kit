// 上傳頁頁首的五個步驟（#242）：完成的步驟下方是 primary 細條，進行中的顯示真實數字（例如批次 2／3）。
// 步驟的狀態由 upload-helpers.ts 的 uploadSteps() 算出。
import { fill, strings } from "../client/i18n";
import type { UploadStep, UploadStepDetail, UploadStepName } from "./upload-helpers";

interface Props {
  steps: UploadStep[];
  language: string;
}

export function UploadSteps({ steps, language }: Props) {
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
  return (
    <ol className="upload-steps" aria-label={s.uploadStepsLabel}>
      {steps.map((step) => (
        <li key={step.name} className={`upload-step is-${step.status}`} aria-current={step.status === "active" ? "step" : undefined}>
          <span className="upload-step__name">{names[step.name]}</span>
          {step.detail !== undefined && <span className="upload-step__detail">{detail(step.detail)}</span>}
        </li>
      ))}
    </ol>
  );
}
