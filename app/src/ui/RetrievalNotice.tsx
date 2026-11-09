// 問答頁與評測台的檢索提示：語意模型準備中（載入中、下載中與進度），或降級（RetrievalFallbackNotice）。判斷在 retrieval-notice.ts
import { fill, strings } from "../client/i18n";
import { Notice } from "./Notice";
import { RetrievalFallbackNotice } from "./RetrievalFallbackNotice";
import { megabytes, retrievalNotice, type ProviderStatus } from "./retrieval-notice";

interface Props {
  language: string;
  // 選用的實作要先準備模型（providers.ts 的 preparesModel()）
  preparesModel: boolean;
  status: ProviderStatus;
}

export function RetrievalNotice({ language, preparesModel, status }: Props) {
  const notice = retrievalNotice(preparesModel, status);
  if (notice === null) return null;
  if (notice.kind === "fallback") return <RetrievalFallbackNotice language={language} fallback={notice.fallback} />;
  const s = strings(language);
  if (notice.kind === "loading") return <Notice kind="info" title={s.modelLoadingTitle}>{s.modelPreparing}</Notice>;
  return (
    <Notice kind="info" title={s.modelDownloadingTitle}>
      {fill(s.modelDownloadProgress, { loaded: megabytes(notice.loaded), total: megabytes(notice.total) })}
      <progress value={notice.loaded} max={notice.total} />
      {s.modelPreparing}
    </Notice>
  );
}
