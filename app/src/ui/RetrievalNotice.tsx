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
  // 手機的登入頁（#355，畫板 K-Mobile）：準備中是「登入」上方的一條進度列（標題、已下載／總共的 MB），不是提示框；降級的提示照常顯示
  bar?: boolean;
}

export function RetrievalNotice({ language, preparesModel, status, compact = false, bar = false }: Props) {
  const notice = retrievalNotice(preparesModel, status);
  if (notice === null) return null;
  if (notice.kind === "fallback") return <RetrievalFallbackNotice language={language} fallback={notice.fallback} />;
  const s = strings(language);
  if (showsAsDot(notice, compact)) {
    const label = notice.kind === "loading" ? s.modelLoadingTitle : s.modelDownloadingTitle;
    return <span className="model-dot" role="status" aria-label={label} title={label} />;
  }
  if (bar) {
    const title = notice.kind === "loading" ? s.modelLoadingTitle : s.modelDownloadingTitle;
    return (
      <div className="model-bar" role="status">
        <p className="model-bar__head">
          <span>{title}</span>
          {notice.kind === "downloading" && <span>{fill(s.modelDownloadBar, { loaded: megabytes(notice.loaded), total: megabytes(notice.total) })}</span>}
        </p>
        {notice.kind === "downloading" && <progress value={notice.loaded} max={notice.total} aria-label={title} />}
      </div>
    );
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
