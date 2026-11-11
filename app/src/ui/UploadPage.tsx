// 上傳頁（docs/upload.md）：選檔、拖放或貼上文字 → 預覽 → 在彈出視窗中確認後寫入（#42）。
// 可選的等級與專案只列出目前身分看得到的；實際能否寫入由 RLS 決定。上傳內容一律以文字節點顯示。
// 切換身分或語言時由 App 以 key 重建本元件，清除表單、預覽與結果。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { chunk } from "../upload/chunk";
import { extractText, formatOf, ParseError } from "../upload/parse";
import { uploadDocument, UploadError } from "../upload/write";
import type { ConflictState } from "../conflicts/run";
import type { ExtractionState } from "../extraction/run";
import { LevelBadge, ProjectBadge } from "./AccessBadges";
import { ConflictStatus } from "./ConflictStatus";
import { ExtractionStatus } from "./ExtractionStatus";
import { FilePicker } from "./FilePicker";
import { Notice } from "./Notice";
import { onlineDemo } from "./online-demo";
import { createRequestGate } from "./requests";
import { fill, strings } from "../client/i18n";
import type { UploadFailure } from "../client/types";
import { audienceRoles, defaultVisibility, formatBytes, todayIso } from "./upload-helpers";

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
}

const { access, client } = clientConfig;

type Job = { title: string; state: ExtractionState; running: boolean; conflict?: ConflictState; conflictRunning: boolean };
const PREVIEW_COUNT = 3;

// 預覽成功後在彈出視窗中確認；寫入中不能關閉，同一份預覽只能寫入一次
type Confirm = {
  passages: string[];
  writing: boolean;
  result?: { documentId: string; count: number };
  error?: UploadFailure;
};

export function UploadPage({ db, identity, language, onUploaded, extractions, onRetryExtraction, onRetryConflicts, onGoto }: Props) {
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
  const parses = useRef(createRequestGate());
  // 連點時 state 還沒更新，以 ref 確保同一份預覽只寫入一次
  const writeStarted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d === null) return;
    if (confirm !== null && !d.open) d.showModal();
    if (confirm === null && d.open) d.close();
  }, [confirm]);

  if (!role?.canUpload) return <p className="card muted">{s.uploadNotAllowed}</p>;

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
  }

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
      setConfirm({ passages, writing: false, result: { documentId: result.documentId, count: result.passageIds.length } });
    } catch (e) {
      // 失敗時可以修改表單後重新預覽；這份預覽不再寫入
      setConfirm({ passages, writing: false, error: e instanceof UploadError ? e.reason : "failed" });
    }
  }

  const summary: [string, ReactNode][] = [
    [s.uploadDocTitle, title],
    [s.uploadLanguage, languageName.of(docLanguage) ?? docLanguage],
    [s.uploadVisibility, <LevelBadge visibility={visibility} language={language} />],
    [s.uploadProject, project === "" ? s.uploadNoProject : <ProjectBadge project={project} language={language} />],
    [s.uploadDate, date === "" ? s.undated : date],
    [s.uploadAudience, audience],
  ];

  return (
    <section className="card upload">
      {/* 線上 demo：另外說明上傳內容會傳給模型供應商（#100 決定 4） */}
      <p className="badge warning">{onlineDemo.enabled ? s.demoUploadNotice : s.uploadEphemeral}</p>
      {extractions.map((job) => (
        <div key={job.state.documentId} className="card">
          <p>{job.title}</p>
          {jobStatus(job)}
        </div>
      ))}
      <div
        className="drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = e.dataTransfer.files[0];
          if (dropped !== undefined) chooseFile(dropped);
        }}
      >
        <FilePicker
          key={fileInputKey}
          inputRef={fileInput}
          accept=".txt,.md,.markdown,.pdf,.docx"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          button={s.uploadFile}
          status={
            file === null ? (
              <span className="muted">{s.fileNone}</span>
            ) : (
              <>
                {fill(s.parenthetical, { text: file.name, note: formatBytes(file.size) })}{" "}
                <button type="button" className="link" onClick={clearFile}>
                  {s.uploadClearFile}
                </button>
              </>
            )
          }
        />
        <p className="muted">{s.uploadDrop}</p>
      </div>
      <label>
        {s.uploadPaste}
        <textarea rows={4} value={pasted} placeholder={s.uploadPastePlaceholder} disabled={file !== null} onChange={(e) => edit(setPasted)(e.target.value)} />
      </label>
      {parseError !== null && (
        // 解析錯誤顯示在檔案區與貼上區旁邊：有檔案時可以清除，沒有時可以重新選檔
        <Notice
          kind="error"
          title={s.noticeParseTitle}
          action={file !== null ? { label: s.uploadClearFile, onClick: clearFile } : { label: s.uploadChooseAgain, onClick: () => fileInput.current?.click() }}
        >
          {s.uploadErrors[parseError]}
        </Notice>
      )}
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
            <dl>
              {summary.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div>
                <dt>{s.uploadPassageCount}</dt>
                <dd>{confirm.passages.length}</dd>
              </div>
            </dl>
            <ol className="upload-preview" lang={docLanguage}>
              {confirm.passages.slice(0, PREVIEW_COUNT).map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
            {confirm.passages.length > PREVIEW_COUNT && (
              <details>
                <summary>{s.uploadShowAll}</summary>
                <ol className="upload-preview" start={PREVIEW_COUNT + 1} lang={docLanguage}>
                  {confirm.passages.slice(PREVIEW_COUNT).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ol>
              </details>
            )}
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
                  {confirm.result.count}
                </p>
                {(() => {
                  const job = extractions.find((x) => x.state.documentId === confirm.result!.documentId);
                  return job && jobStatus(job);
                })()}
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
      </dialog>
    </section>
  );
}
