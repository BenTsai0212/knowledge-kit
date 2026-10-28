// 上傳頁（docs/upload.md）：選檔或貼上文字 → 預覽段落 → 確認後寫入。可選的等級與專案只列出目前身分看得到的；
// 實際能否寫入由 RLS 決定。上傳內容一律以文字節點顯示。切換身分或語言時由 App 以 key 重建本元件，清除表單、預覽與結果。
import { useRef, useState } from "react";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { chunk } from "../upload/chunk";
import { extractText, formatOf, ParseError } from "../upload/parse";
import { uploadDocument, UploadError } from "../upload/write";
import { createRequestGate } from "./requests";
import { strings, type UploadFailure } from "./strings";

interface Props {
  db: Database;
  identity: string;
  language: string;
  onGoto(view: "qa" | "timeline"): void;
}

const { access, client } = clientConfig;

type Status =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "preview"; passages: string[] }
  | { kind: "done"; count: number }
  | { kind: "error"; reason: UploadFailure };

export function UploadPage({ db, identity, language, onGoto }: Props) {
  const s = strings(language);
  const role = access.roles.find((r) => r.id === identity);
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  const levels = role ? access.visibilityLevels.filter((l) => l.rank <= rank.get(role.visibility)!) : [];
  const projects = role ? access.projects.filter((p) => role.projects.includes(p.id)) : [];
  const languageName = new Intl.DisplayNames([language], { type: "language" });

  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [title, setTitle] = useState("");
  const [docLanguage, setDocLanguage] = useState(language);
  const [visibility, setVisibility] = useState(levels[0]?.id ?? "");
  const [project, setProject] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const parses = useRef(createRequestGate());

  if (!role?.canUpload) return <p className="card muted">{s.uploadNotAllowed}</p>;

  // 改了內容或設定就要重新預覽
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    parses.current.cancel();
    setStatus({ kind: "idle" });
  };

  async function preview() {
    const ticket = parses.current.begin();
    setStatus({ kind: "parsing" });
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
      if (ticket.isCurrent()) setStatus({ kind: "preview", passages });
    } catch (e) {
      if (!ticket.isCurrent()) return;
      const noInput = file === null && pasted.trim() === "";
      setStatus({ kind: "error", reason: noInput ? "no_input" : e instanceof ParseError ? e.reason : "failed" });
    }
  }

  async function submit(passages: string[]) {
    try {
      const result = await uploadDocument(
        db,
        identity,
        { title, language: docLanguage, visibility, project: project === "" ? null : project, date: date === "" ? null : date, passages },
        { languages: client.languages },
      );
      setStatus({ kind: "done", count: result.passageIds.length });
    } catch (e) {
      setStatus({ kind: "error", reason: e instanceof UploadError ? e.reason : "failed" });
    }
  }

  return (
    <section className="card upload">
      <p className="badge warning">{s.uploadEphemeral}</p>
      <label>
        {s.uploadFile}
        <input
          type="file"
          accept=".txt,.md,.markdown,.pdf,.docx"
          onChange={(e) => {
            const chosen = e.target.files?.[0] ?? null;
            edit(setFile)(chosen);
            if (chosen !== null && title === "") setTitle(chosen.name.replace(/\.[^.]+$/, ""));
          }}
        />
      </label>
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
      <label>
        {s.uploadDate}
        <input type="date" value={date} onChange={(e) => edit(setDate)(e.target.value)} />
      </label>
      <button type="button" disabled={status.kind === "parsing"} onClick={() => void preview()}>
        {s.uploadPreview}
      </button>

      {status.kind === "parsing" && <p className="muted">{s.uploadParsing}</p>}
      {status.kind === "error" && <p className="error">{s.uploadErrors[status.reason]}</p>}
      {status.kind === "preview" && (
        <div className="upload-preview">
          <p>
            {s.uploadPassageCount}
            {s.colon}
            {status.passages.length}
          </p>
          <ol lang={docLanguage}>
            {status.passages.slice(0, 5).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
          <button type="button" onClick={() => void submit(status.passages)}>
            {s.uploadSubmit}
          </button>
        </div>
      )}
      {status.kind === "done" && (
        <div>
          <p>
            {s.uploadDone} {s.uploadPassageCount}
            {s.colon}
            {status.count}
          </p>
          <button type="button" onClick={() => onGoto("qa")}>
            {s.uploadGotoQa}
          </button>{" "}
          <button type="button" onClick={() => onGoto("timeline")}>
            {s.uploadGotoTimeline}
          </button>
        </div>
      )}
    </section>
  );
}
