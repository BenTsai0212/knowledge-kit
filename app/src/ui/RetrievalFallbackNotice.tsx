// 語意向量 provider 準備失敗、改用 keyword-hash 時的提示（docs/retrieval.md「降級」）：問答頁與評測台都顯示。
import { strings } from "../client/i18n";
import type { ProviderFallback } from "../retrieval/providers";
import { Notice } from "./Notice";

interface Props {
  language: string;
  // 沒有降級（或還在準備）時為 null
  fallback: ProviderFallback | null;
}

export function RetrievalFallbackNotice({ language, fallback }: Props) {
  if (fallback === null) return null;
  const s = strings(language);
  return (
    <Notice kind="warning" title={s.retrievalFallbackTitle}>
      {s.retrievalFallback[fallback.reason]}
    </Notice>
  );
}
