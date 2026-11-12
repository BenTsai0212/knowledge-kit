// 上傳頁（docs/upload.md）：選檔、拖放或貼上文字 → 預覽 → 在彈出視窗中確認後寫入（#42）。
// 頁首是五個步驟，拖放區、檔案卡片、預覽與確認區套用設計系統 v1 的版面與動態（#242）。
// 寫入後，確認區的原文預覽依萃取的真實進度畫出找到的字詞（類型色底線），說法不同的段落標 conflictSoft（#242 PR 2）。
// 萃取完成、已送審時，一顆標記從面板飛向導覽的「待審」（#242 PR 3）。
// 可選的等級與專案只列出目前身分看得到的；實際能否寫入由 RLS 決定。上傳內容一律以文字節點顯示。
// 分成「新增文件」與「我的上傳」（#284）：送出後顯示四步進度；退回的文件可「重新上傳修正版」，帶入原本的設定後回到新增文件。
// 切換身分或語言時由 App 以 key 重建本元件，清除表單、預覽與結果。
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { chunk } from "../upload/chunk";
import { extractText, formatOf, MAX_FILE_BYTES, ParseError } from "../upload/parse";
import { uploadDocument, UploadError } from "../upload/write";
import type { ConflictState } from "../conflicts/run";
import type { ExtractionState } from "../extraction/run";
import { LevelBadge, ProjectBadge } from "./AccessBadges";
import { ConflictStatus } from "./ConflictStatus";
import { EMPTY_ICONS, focusIdentity } from "./empty-state";
import { EmptyState } from "./EmptyState";
import { ExtractionStatus } from "./ExtractionStatus";
import { FilePicker } from "./FilePicker";
import { countsFromBatches, type Reupload } from "./my-uploads";
import { MyUploads, ReviewProgress } from "./MyUploads";
import { Notice } from "./Notice";
import { onlineDemo } from "./online-demo";
import { REDUCED_MOTION, staggerIndex } from "./motion";
import { createRequestGate } from "./requests";
import { nextTab } from "./review-helpers";
import { fill, strings } from "../client/i18n";
import type { UploadFailure } from "../client/types";
import { tabSelector } from "./Sidebar";
import {
  audienceRoles,
  defaultVisibility,
  flyPath,
  foundTerms,
  formatBytes,
  todayIso,
  underlineRanges,
  uploadSteps,
  passagesWordCount,
  sentForReview,
  type FlyPath,
  type FoundTerm,
} from "./upload-helpers";
import { UploadSteps } from "./UploadSteps";

interface Props {
  db: Database;
  identity: string;
  language: string;
  // 上傳成功：App 記錄「上傳」標籤，並在背景萃取實體與關係（#44）
  onUploaded(upload: { documentId: string; title: string; date: string | null; documentLanguage: string; passages: { id: string; content: string }[] }): void;
  // 目前身分在本次工作階段上傳的文件的萃取狀態，以及重試
  // conflict：萃取後的比對（#51，conflicts.enabled 時）；還沒開始時為 undefined
  extractions: Job[];
  onRetryExtraction(documentId: string): void;
  onRetryConflicts(documentId: string): void;
  // 到時間軸時帶上剛上傳的文件與它的語言，以便捲動到該文件
  onGoto(view: "qa" | "timeline", document?: { id: string; language: string }): void;
  // 帳號登入時身分固定（#287）：空狀態不給「切換身分」
  canSwitchIdentity: boolean;
  // 首頁「有更新」的「查看進度」（#284）：打開「我的上傳」並選取這份文件；讀過後呼叫 onFocused
  focus?: string | null;
  onFocused?(): void;
}

const { access, client, knowledgeModel } = clientConfig;
const typeColor = (type: string) => knowledgeModel.entityTypes.find((t) => t.id === type)?.color ?? "var(--color-graphFallback)";

type Job = { title: string; state: ExtractionState; running: boolean; conflict?: ConflictState; conflictRunning: boolean };
const PREVIEW_COUNT = 3;
// 已送審的標記的直徑（px），與 app.css 的 .upload-fly 相同
const FLY_SIZE = 12;

// 上傳頁的兩段（#284）：新增文件、我的上傳
const SECTIONS = ["new", "mine"] as const;
type Section = (typeof SECTIONS)[number];

// 預覽成功後在彈出視窗中確認；寫入中不能關閉，同一份預覽只能寫入一次
type Confirm = {
  passages: string[];
  writing: boolean;
  result?: { documentId: string; passageIds: string[] };
  error?: UploadFailure;
};

export function UploadPage({ db, identity, language, onUploaded, extractions, onRetryExtraction, onRetryConflicts, onGoto, canSwitchIdentity, focus = null, onFocused }: Props) {
  const s = strings(language);
  // 萃取的狀態，以及（開啟比對時）比對的狀態
  const jobStatus = (job: Job) => (
    <>
      <ExtractionStatus state={job.state} running={job.running} language={language} onRetry={() => onRetryExtraction(job.state.documentId)} />
      {client.conflicts.enabled && (
        <ConflictStatus state={job.conflict} running={job.conflictRunning} language={language} onRetry={() => onRetryConflicts(job.state.documentId)} />
      )}
    </>
  );
  const role = access.roles.find((r) => r.id === identity);
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  const levels = role ? access.visibilityLevels.filter((l) => l.rank <= rank.get(role.visibility)!) : [];
  const projects = role ? access.projects.filter((p) => role.projects.includes(p.id)) : [];
  const languageName = new Intl.DisplayNames([language], { type: "language" });

  const [file, setFile] = useState<File | null>(null);
  // 清除檔案時換一個 key 重建 <input type="file">，讓它忘記已選的檔案
  const [fileInputKey, setFileInputKey] = useState(0);
  const [pasted, setPasted] = useState("");
  const [title, setTitle] = useState("");
  const [docLanguage, setDocLanguage] = useState(language);
  const [visibility, setVisibility] = useState(() => defaultVisibility(access, identity));
  const [project, setProject] = useState("");
  const [date, setDate] = useState(todayIso);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<UploadFailure | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // 拖著檔案進入拖放區（#242）：框線變實線、底色變淺、圖示上浮
  const [dragOver, setDragOver] = useState(false);
  const [section, setSection] = useState<Section>(focus === null ? "new" : "mine");
  // 一開始要選取的文件只在建立時讀一次，之後清掉，下次從導覽打開時回到「新增文件」
  const [initialMine] = useState(focus);
  useEffect(() => {
    if (initialMine !== null) onFocused?.();
  }, [initialMine, onFocused]);
  // 重新上傳修正版時帶入的原本設定（#284）；再上傳一份時移除提示
  const [reupload, setReupload] = useState<Reupload | null>(null);
  const ids = useId();
  const parses = useRef(createRequestGate());
  // 連點時 state 還沒更新，以 ref 確保同一份預覽只寫入一次
  const writeStarted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const written = confirm?.result?.documentId;
  const writtenJob = written === undefined ? undefined : extractions.find((x) => x.state.documentId === written);
  const steps = uploadSteps({
    hasInput: file !== null || pasted.trim() !== "",
    parsing,
    passages: confirm?.passages.length ?? null,
    written: written !== undefined,
    batches: writtenJob?.state.batches ?? null,
  });
  // 已送審（#242 PR 3）：萃取完成且有送審時，一顆標記從面板內的「人工審核」飛向導覽的「待審」數量，每份文件只飛一次
  const sent = written !== undefined && sentForReview(steps);
  const [fly, setFly] = useState<(FlyPath & { key: string }) | null>(null);
  const flown = useRef(new Set<string>());

  useEffect(() => {
    if (!sent || written === undefined || flown.current.has(written)) return;
    flown.current.add(written);
    // 減少動態效果時不飛（待審數量直接更新）；沒有「待審」頁籤的身分與展示模式找不到終點，也不飛
    if (window.matchMedia?.(REDUCED_MOTION).matches) return;
    const from = dialog.current?.querySelector('[data-step="review"]');
    const to = document.querySelector(`${tabSelector("review")} .tab-count`) ?? document.querySelector(tabSelector("review"));
    if (!from || !to) return;
    setFly({ key: written, ...flyPath(from.getBoundingClientRect(), to.getBoundingClientRect(), FLY_SIZE) });
  }, [sent, written]);

  useEffect(() => {
    const d = dialog.current;
    if (d === null) return;
    if (confirm !== null && !d.open) d.showModal();
    if (confirm === null && d.open) d.close();
  }, [confirm]);

  if (!role?.canUpload)
    return <EmptyState icon="upload" title={s.uploadNotAllowed} reason={s.uploadNotAllowedReason} actions={canSwitchIdentity ? [{ label: s.switchIdentity, onClick: focusIdentity }] : []} />;

  const audience = audienceRoles(access, visibility, project === "" ? null : project)
    .map((r) => r.label[language])
    .join(s.listSeparator);

  // 改了內容或設定就要重新預覽
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    parses.current.cancel();
    setParsing(false);
    setParseError(null);
  };

  function chooseFile(chosen: File | null) {
    edit(setFile)(chosen);
    if (chosen !== null && title === "") setTitle(chosen.name.replace(/\.[^.]+$/, ""));
  }

  function clearFile() {
    edit(setFile)(null);
    setFileInputKey((k) => k + 1);
  }

  function resetForm() {
    clearFile();
    setPasted("");
    setTitle("");
    setDocLanguage(language);
    setVisibility(defaultVisibility(access, identity));
    setProject("");
    setDate(todayIso());
    setReupload(null);
  }

  // 重新上傳修正版：帶入標題、語言、可見等級與專案（目前身分不能選的不帶入），清掉已選的檔案與貼上的文字，回到新增文件
  function startReupload(r: Reupload) {
    clearFile();
    setPasted("");
    setTitle(r.title);
    if (client.languages.includes(r.language)) setDocLanguage(r.language);
    if (levels.some((l) => l.id === r.visibility)) setVisibility(r.visibility);
    setProject(r.project !== null && projects.some((p) => p.id === r.project) ? r.project : "");
    setDate(todayIso());
    setReupload(r);
    setSection("new");
  }

  const sectionKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTab(SECTIONS, section, ev.key);
    if (next === null) return;
    ev.preventDefault();
    setSection(next);
    document.getElementById(`${ids}-tab-${next}`)?.focus();
  };
  const sectionLabels: Record<Section, string> = { new: s.myUploads.tabNew, mine: s.myUploads.tabMine };
  // 我的上傳：本工作階段還在萃取的文件；萃取有進展時重新讀取
  const extractingIds = new Set(extractions.filter((x) => countsFromBatches(x.state.batches, x.running).extracting).map((x) => x.state.documentId));
  const refreshKey = extractions.map((x) => `${x.state.documentId}:${x.running}:${x.state.batches.map((b) => b.status).join(",")}`).join("|");

  async function preview() {
    const ticket = parses.current.begin();
    setParsing(true);
    setParseError(null);
    try {
      let passages: string[];
      if (file !== null) {
        const format = formatOf(file.name);
        if (format === null) throw new ParseError("unsupported");
        passages = chunk(await extractText(new Uint8Array(await file.arrayBuffer()), format), client.upload.passageMaxChars);
      } else if (pasted.trim() !== "") {
        passages = chunk(await extractText(new TextEncoder().encode(pasted), "text"), client.upload.passageMaxChars);
      } else {
        throw new ParseError("empty");
      }
      if (!ticket.isCurrent()) return;
      writeStarted.current = false;
      setConfirm({ passages, writing: false });
    } catch (e) {
      if (!ticket.isCurrent()) return;
      const noInput = file === null && pasted.trim() === "";
      setParseError(noInput ? "no_input" : e instanceof ParseError ? e.reason : "failed");
    } finally {
      if (ticket.isCurrent()) setParsing(false);
    }
  }

  async function submit(passages: string[]) {
    if (writeStarted.current) return;
    writeStarted.current = true;
    setConfirm({ passages, writing: true });
    try {
      const result = await uploadDocument(
        db,
        identity,
        { title, language: docLanguage, visibility, project: project === "" ? null : project, date: date === "" ? null : date, passages },
        { languages: client.languages },
      );
      onUploaded({
        documentId: result.documentId,
        title,
        date: date === "" ? null : date,
        documentLanguage: docLanguage,
        passages: result.passageIds.map((id, i) => ({ id, content: passages[i] })),
      });
      setConfirm({ passages, writing: false, result: { documentId: result.documentId, passageIds: result.passageIds } });
    } catch (e) {
      // 失敗時可以修改表單後重新預覽；這份預覽不再寫入
      setConfirm({ passages, writing: false, error: e instanceof UploadError ? e.reason : "failed" });
    }
  }

  // 確認區先列「誰看得到」與專案，再是其他設定與上傳按鈕（#242）
  const summary: [string, ReactNode][] = [
    [s.uploadAudience, audience],
    [s.uploadVisibility, <LevelBadge visibility={visibility} language={language} />],
    [s.uploadProject, project === "" ? s.uploadNoProject : <ProjectBadge project={project} language={language} />],
    [s.uploadDocTitle, title],
    [s.uploadLanguage, languageName.of(docLanguage) ?? docLanguage],
    [s.uploadDate, date === "" ? s.undated : date],
  ];

  const icon = (className: string) => (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={EMPTY_ICONS.upload} />
    </svg>
  );
  // 寫入後：找到的字詞與說法不同的段落（萃取、比對完成的部分）
  const terms = writtenJob === undefined ? [] : foundTerms(writtenJob.state.batches);
  const conflicted = new Set(writtenJob?.conflict?.passages ?? []);
  // 找到的字詞依序畫出類型色底線（sweep）；key 用位置，之後的批次不重播已畫出的底線
  const underlined = (text: string, found: FoundTerm[]) => {
    const parts: ReactNode[] = [];
    let at = 0;
    for (const r of underlineRanges(text, found)) {
      if (r.start > at) parts.push(text.slice(at, r.start));
      parts.push(
        <span key={r.start} className="upload-found" style={{ "--type-color": typeColor(r.type), "--i": staggerIndex(r.order) } as CSSProperties}>
          {text.slice(r.start, r.end)}
        </span>,
      );
      at = r.end;
    }
    parts.push(text.slice(at));
    return parts;
  };
  // 預覽段落逐條升起（stagger 60ms，超過 6 項不再延遲）
  const passageList = (passages: string[], start: number) =>
    passages.map((p, i) => {
      const id = confirm?.result?.passageIds[start + i];
      return (
        <li key={start + i} className={id !== undefined && conflicted.has(id) ? "is-conflict" : undefined} style={{ "--i": staggerIndex(start + i) } as CSSProperties}>
          {underlined(p, terms)}
        </li>
      );
    });

  const newPanel = (
    <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-new`} className="upload">
      {reupload !== null && (
        <Notice kind="info" title={s.myUploads.reupload}>
          {s.myUploads.reuploadNotice}
        </Notice>
      )}
      <UploadSteps steps={steps} language={language} />
      {/* 線上 demo：另外說明上傳內容會傳給模型供應商（#100 決定 4） */}
      <p className="badge warning">{onlineDemo.enabled ? s.demoUploadNotice : s.uploadEphemeral}</p>
      <div
        className={`drop-zone${dragOver ? " is-over" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        // 移到拖放區內的子元素也會觸發 dragleave：只有離開整個拖放區才算離開
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped !== undefined) chooseFile(dropped);
        }}
      >
        {parseError !== null ? (
          // 讀取失敗：在拖放區原地換成說明，附「清除檔案」（有選檔時）或「重新選檔」；不搖晃、不用大面積的紅色
          <Notice
            kind="error"
            title={s.noticeParseTitle}
            action={file !== null ? { label: s.uploadClearFile, onClick: clearFile } : { label: s.uploadChooseAgain, onClick: () => fileInput.current?.click() }}
          >
            {s.uploadErrors[parseError]}
          </Notice>
        ) : file === null ? (
          <>
            {icon("drop-zone__icon")}
            <p className="drop-zone__title">{s.uploadDrop}</p>
            <p className="muted">{fill(s.uploadDropHint, { size: formatBytes(MAX_FILE_BYTES) })}</p>
          </>
        ) : (
          // 放下或選好檔案後，檔案卡片落定（settle）；換檔時重播
          <div key={`${file.name}:${file.size}:${file.lastModified}`} className="upload-file">
            {icon("upload-file__icon")}
            <span className="upload-file__name">{file.name}</span>
            <span className="muted">{formatBytes(file.size)}</span>
            <button type="button" className="link" onClick={clearFile}>
              {s.uploadClearFile}
            </button>
          </div>
        )}
        <FilePicker
          key={fileInputKey}
          inputRef={fileInput}
          accept=".txt,.md,.markdown,.pdf,.docx"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          button={s.uploadFile}
          status={file === null ? <span className="muted">{s.fileNone}</span> : null}
        />
      </div>
      <label>
        {s.uploadPaste}
        <textarea rows={4} value={pasted} placeholder={s.uploadPastePlaceholder} disabled={file !== null} onChange={(e) => edit(setPasted)(e.target.value)} />
      </label>
      <label>
        {s.uploadDocTitle}
        <input type="text" value={title} onChange={(e) => edit(setTitle)(e.target.value)} />
      </label>
      <label>
        {s.uploadLanguage}
        <select value={docLanguage} onChange={(e) => edit(setDocLanguage)(e.target.value)}>
          {client.languages.map((code) => (
            <option key={code} value={code}>
              {languageName.of(code) ?? code}
            </option>
          ))}
        </select>
      </label>
      <label>
        {s.uploadVisibility}
        <select value={visibility} onChange={(e) => edit(setVisibility)(e.target.value)}>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label[language]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {s.uploadProject}
        <select value={project} onChange={(e) => edit(setProject)(e.target.value)}>
          <option value="">{s.uploadNoProject}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label[language]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        {s.uploadAudience}
        {s.colon}
        {audience}
      </p>
      <label>
        {s.uploadDate}
        <input type="date" value={date} onChange={(e) => edit(setDate)(e.target.value)} />
      </label>
      <button type="button" disabled={parsing} onClick={() => void preview()}>
        {parsing ? s.uploadParsing : s.uploadPreview}
      </button>
      {/* 這次工作階段上傳過的文件：萃取在背景繼續，與頁首步驟（目前這一份）分開，每份標明標題（#242 審查） */}
      {extractions.length > 0 && (
        <section className="upload-recent">
          <h2>{s.uploadRecentTitle}</h2>
          {extractions.map((job) => (
            <div key={job.state.documentId} className="card">
              <strong>{job.title}</strong>
              {jobStatus(job)}
            </div>
          ))}
        </section>
      )}
    </div>
  );

  return (
    <section className="card upload">
      <div className="review-tabs upload-sections" role="tablist" aria-label={s.myUploads.sections} onKeyDown={sectionKey}>
        {SECTIONS.map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            id={`${ids}-tab-${x}`}
            aria-selected={section === x}
            aria-controls={`${ids}-panel`}
            tabIndex={section === x ? 0 : -1}
            onClick={() => setSection(x)}
          >
            {sectionLabels[x]}
          </button>
        ))}
      </div>
      {section === "new" ? (
        newPanel
      ) : (
        <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-mine`}>
          <MyUploads
            db={db}
            identity={identity}
            language={language}
            extracting={extractingIds}
            refreshKey={refreshKey}
            jobStatus={(id) => {
              const job = extractions.find((x) => x.state.documentId === id);
              return job === undefined ? null : jobStatus(job);
            }}
            onReupload={startReupload}
            initialSelected={initialMine}
          />
        </div>
      )}

      <dialog
        ref={dialog}
        className="upload-dialog"
        aria-label={s.uploadConfirmTitle}
        // Esc：寫入中不關閉；其他時候關閉並保留表單
        onCancel={(e) => confirm?.writing && e.preventDefault()}
        onClose={() => setConfirm(null)}
      >
        {confirm !== null && (
          <>
            <header className="dialog-header">
              <h2>{s.uploadConfirmTitle}</h2>
              {/* 與 Esc、「返回修改」相同：保留表單內容；寫入中停用 */}
              <button type="button" className="icon-button" aria-label={s.dialogClose} title={s.dialogClose} disabled={confirm.writing} onClick={() => setConfirm(null)}>
                ✕
              </button>
            </header>
            {/* 頁首的步驟在確認面板後方會被遮住：面板內也顯示一份（#242 審查） */}
            <UploadSteps steps={steps} language={language} />
            {/* 檔案卡片：檔名、段落數、字數；預覽段落放在 reading 紙面上逐條升起 */}
            <div className="upload-file-card">
              <strong className="upload-file-card__name">{file?.name ?? s.uploadPastedText}</strong>
              <span className="upload-file-card__stats muted">
                {fill(s.uploadFileStats, { passages: confirm.passages.length, words: passagesWordCount(confirm.passages) })}
              </span>
            </div>
            <ol className="upload-preview" lang={docLanguage}>
              {passageList(confirm.passages.slice(0, PREVIEW_COUNT), 0)}
            </ol>
            {confirm.passages.length > PREVIEW_COUNT && (
              <details>
                <summary>{s.uploadShowAll}</summary>
                <ol className="upload-preview" start={PREVIEW_COUNT + 1} lang={docLanguage}>
                  {passageList(confirm.passages.slice(PREVIEW_COUNT), PREVIEW_COUNT)}
                </ol>
              </details>
            )}
            <dl>
              {summary.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {confirm.error !== undefined && (
              <Notice kind="error" title={s.noticeWriteTitle} action={{ label: s.uploadBack, onClick: () => setConfirm(null) }}>
                {s.uploadErrors[confirm.error]}
              </Notice>
            )}
            {confirm.result === undefined ? (
              <div className="dialog-actions">
                <button
                  type="button"
                  disabled={confirm.writing || confirm.error !== undefined}
                  onClick={() => void submit(confirm.passages)}
                >
                  {confirm.writing ? s.uploadWriting : s.uploadSubmit}
                </button>
                <button type="button" className="secondary" disabled={confirm.writing} onClick={() => setConfirm(null)}>
                  {s.uploadBack}
                </button>
              </div>
            ) : (
              <>
                <p>
                  {s.uploadDone} {s.uploadPassageCount}
                  {s.colon}
                  {confirm.result.passageIds.length}
                </p>
                {/* 送出後的四步進度（#284）：主管核准後才會出現在問答與圖譜 */}
                {writtenJob && <ReviewProgress counts={countsFromBatches(writtenJob.state.batches, writtenJob.running)} language={language} />}
                {writtenJob && jobStatus(writtenJob)}
                <div className="dialog-actions">
                  <button type="button" onClick={() => onGoto("qa")}>
                    {s.uploadGotoQa}
                  </button>
                  <button type="button" onClick={() => onGoto("timeline", { id: confirm.result!.documentId, language: docLanguage })}>
                    {s.uploadGotoTimeline}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      resetForm();
                      setConfirm(null);
                    }}
                  >
                    {s.uploadAnother}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {/* 在 dialog 內才會在面板的 backdrop 之上；位置固定在終點，結束後移除。關閉面板或再上傳一份時一併移除 */}
        {fly !== null && fly.key === written && (
          <span
            key={fly.key}
            className="upload-fly"
            aria-hidden="true"
            style={{ left: fly.left, top: fly.top, "--fly-x": `${fly.x}px`, "--fly-y": `${fly.y}px` } as CSSProperties}
            onAnimationEnd={() => setFly(null)}
          />
        )}
      </dialog>
    </section>
  );
}
