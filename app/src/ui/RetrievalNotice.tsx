// 問答頁與評測台的檢索提示：語意模型準備中（載入中、下載中與進度），或降級（RetrievalFallbackNotice）。判斷在 retrieval-notice.ts
import { fill, strings } from "../client/i18n";
import { Notice } from "./Notice";
import { RetrievalFallbackNotice } from "./RetrievalFallbackNotice";
import { megabytes, retrievalNotice, showsAsDot, type ProviderStatus } from "./retrieval-notice";

interface Props {
  language: string;
  // 選用的實作要先準備模型（providers.ts 的 preparesModel()）
  preparesModel: boolean;
  status: ProviderStatus;
  // 展示模式（#260）：準備中縮成頂端的小點，完成後消失
  compact?: boolean;
}

export function RetrievalNotice({ language, preparesModel, status, compact = false }: Props) {
  const notice = retrievalNotice(preparesModel, status);
  if (notice === null) return null;
  if (notice.kind === "fallback") return <RetrievalFallbackNotice language={language} fallback={notice.fallback} />;
  const s = strings(language);
  if (showsAsDot(notice, compact)) {
    const label = notice.kind === "loading" ? s.modelLoadingTitle : s.modelDownloadingTitle;
    return <span className="model-dot" role="status" aria-label={label} title={label} />;
  }
  if (notice.kind === "loading") return <Notice kind="info" title={s.modelLoadingTitle}>{s.modelPreparing}</Notice>;
  return (
    <Notice kind="info" title={s.modelDownloadingTitle}>
      {fill(s.modelDownloadProgress, { loaded: megabytes(notice.loaded), total: megabytes(notice.total) })}
      <progress value={notice.loaded} max={notice.total} />
      {s.modelPreparing}
    </Notice>
  );
}
