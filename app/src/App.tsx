// 主畫面：PGlite 在瀏覽器中載入並匯入資料集；身分與語言切換；問答（需要邀請碼）、圖譜、時間軸、上傳（後三者不呼叫模型）四個頁籤；引用跳回原文。
import { useEffect, useMemo, useRef, useState } from "react";
import { clientConfig } from "./client/load";
import { planConflicts, runConflicts, shouldDetectConflicts, type ConflictState } from "./conflicts/run";
import { readConflicts } from "./conflicts/store";
import { dataset } from "./dataset/load";
import { seedDataset } from "./dataset/seed";
import { openDatabase, type Database } from "./db/database";
import { planExtraction, runExtraction, type ExtractionState } from "./extraction/run";
import { readReview } from "./extraction/store";
import { ask } from "./qa/answer";
import { apiTransport } from "./qa/api";
import { openRetriever } from "./retrieval/retrieve";
import { readSource, type SourceDocument } from "./sources/source";
import { clearAccessCode, loadAccessCode, saveAccessCode } from "./ui/access-code";
import { AccessCodeForm } from "./ui/AccessCodeForm";
import { AnswerView, type AnswerState } from "./ui/AnswerView";
import { GraphPage } from "./ui/GraphPage";
import { QuestionPanel } from "./ui/QuestionPanel";
import { ReviewPage } from "./ui/ReviewPage";
import { pendingCount } from "./ui/review-helpers";
import { createExtractionRunner } from "./ui/extraction-runner";
import { createRequestGate } from "./ui/requests";
import { SourcePanel } from "./ui/SourcePanel";
import { strings } from "./ui/strings";
import { TimelinePage } from "./ui/TimelinePage";
import { UploadPage } from "./ui/UploadPage";
import { Toolbar } from "./ui/Toolbar";

const { client, access } = clientConfig;

type View = "qa" | "graph" | "timeline" | "upload" | "review";

export function App() {
  const [view, setView] = useState<View>("qa");
  const [language, setLanguage] = useState(client.defaultLanguage);
  const [identity, setIdentity] = useState(access.roles[0].id);
  const [accessCode, setAccessCode] = useState(loadAccessCode);
  const [codeRejected, setCodeRejected] = useState(false);
  const [db, setDb] = useState<Database | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [source, setSource] = useState<SourceDocument | null>(null);
  // 本次工作階段上傳的文件（時間軸加上「上傳」標籤），以及從上傳頁跳到時間軸時要捲動到的文件（#42）
  const [uploaded, setUploaded] = useState<ReadonlySet<string>>(new Set());
  const [focusDocument, setFocusDocument] = useState<string | null>(null);
  // 萃取在背景執行，由 App 管理：切換身分、語言或頁籤都不中斷（#44 決定的補充 1）
  const [extractions, setExtractions] = useState<Record<string, { title: string; date: string | null; state: ExtractionState }>>({});
  const latestExtractions = useRef(extractions);
  latestExtractions.current = extractions;
  // 實際執行中的萃取（文件 id）；「萃取中」以此判斷，不看批次狀態（#47 審查）
  const [activeExtractions, setActiveExtractions] = useState<ReadonlySet<string>>(new Set());
  const extractionRunner = useRef(createExtractionRunner(setActiveExtractions));
  // 萃取後的比對（#51）：與萃取相同，在背景執行、同一份文件同時只執行一個
  const [conflictJobs, setConflictJobs] = useState<Record<string, ConflictState>>({});
  const latestConflicts = useRef(conflictJobs);
  latestConflicts.current = conflictJobs;
  const [activeConflicts, setActiveConflicts] = useState<ReadonlySet<string>>(new Set());
  const conflictRunner = useRef(createExtractionRunner(setActiveConflicts));
  // 同時只有一個有效的提問與原文讀取；切換身分或語言時捨棄進行中的
  const questions = useRef(createRequestGate());
  const sources = useRef(createRequestGate());
  // 「待審」頁籤的筆數（#48）：待審的實體與關係，加上待處理的說法不同（#51）。
  // 核准、退回、處理、重新整理（reviewVersion）與萃取、比對結束（activeExtractions、activeConflicts）後重新讀取。
  // 記下讀取時的身分，切換身分後不顯示前一個身分的筆數
  const canReview = access.roles.find((r) => r.id === identity)?.canReview ?? false;
  const [reviewVersion, setReviewVersion] = useState(0);
  const [pending, setPending] = useState<{ identity: string; count: number } | null>(null);
  const s = strings(language);

  useEffect(() => {
    // StrictMode 在開發時會執行兩次；先結束的那次關閉自己開的資料庫
    let cancelled = false;
    let opened: Database | undefined;
    openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) }).then(
      (database) => (cancelled ? void database.close() : setDb((opened = database))),
      () => !cancelled && setLoadFailed(true),
    );
    return () => {
      cancelled = true;
      void opened?.close();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = client.displayName[language];
  }, [language]);

  useEffect(() => {
    if (db === null || !canReview) return;
    let cancelled = false;
    void Promise.all([readReview(db, identity), readConflicts(db, identity)]).then(([docs, conflicts]) => {
      if (!cancelled) setPending({ identity, count: pendingCount(docs, conflicts) });
    });
    return () => {
      cancelled = true;
    };
  }, [db, identity, canReview, reviewVersion, activeExtractions, activeConflicts]);

  const retriever = useMemo(() => (db === null ? null : openRetriever(db, client.retrieval)), [db]);

  // 切換身分或語言：清掉回答與原文，之後才到的結果一律忽略
  function discard() {
    questions.current.cancel();
    sources.current.cancel();
    setAnswer(null);
    setSource(null);
  }

  // 邀請碼被拒：清除，回到輸入畫面（#26 決定 3）
  function rejectAccessCode() {
    clearAccessCode();
    setAccessCode(null);
    setCodeRejected(true);
  }

  async function onAsk(question: string) {
    if (retriever === null || accessCode === null) return;
    sources.current.cancel();
    setSource(null);
    // 以送出當下的身分與語言提問
    const ticket = questions.current.begin();
    setAnswer({ question, streaming: "" });
    const ctx = { retriever, transport: apiTransport({ accessCode }), model: client.model, displayName: client.displayName };
    const result = await ask(
      ctx,
      { identityId: identity, text: question, language },
      (streaming) => ticket.isCurrent() && setAnswer({ question, streaming }),
      ticket.signal,
    );
    if (!ticket.isCurrent()) return;
    if (result.kind === "error" && result.error === "invalid_access_code") {
      rejectAccessCode();
      setAnswer(null);
      return;
    }
    setAnswer({ question, streaming: "", answer: result });
  }

  // 以上傳時記錄的身分寫入待審；邀請碼用開始（或重試）當下的碼，沒有碼時記為失敗，輸入後可以重試
  async function extract(documentId: string, state: ExtractionState) {
    if (db === null || extractionRunner.current.isRunning(documentId)) return;
    const save = (next: ExtractionState) => setExtractions((all) => ({ ...all, [documentId]: { ...all[documentId], state: next } }));
    if (accessCode === null) {
      save({ ...state, batches: state.batches.map((b) => (b.status === "done" ? b : { ...b, status: "failed", error: "no_access_code" })) });
      return;
    }
    const final = await extractionRunner.current.run(documentId, () =>
      runExtraction({ db, transport: apiTransport({ accessCode }), config: clientConfig }, state, save),
    );
    // 與問答相同：清除被拒的碼，回到輸入畫面
    if (final?.batches.some((b) => b.error === "invalid_access_code")) rejectAccessCode();
    // 萃取結束後比對說法不同（docs/conflicts.md「流程」）；重試萃取成功後也會接著比對
    else if (final !== undefined && shouldDetectConflicts(clientConfig, final)) void detect(documentId);
  }

  // 比對說法不同：第一次執行時以上傳者的身分挑選段落並固定下來，重試時送出相同的內容；邀請碼的處理與萃取相同
  async function detect(documentId: string) {
    const job = latestExtractions.current[documentId];
    if (db === null || retriever === null || job === undefined || conflictRunner.current.isRunning(documentId)) return;
    const save = (next: ConflictState) => setConflictJobs((all) => ({ ...all, [documentId]: next }));
    const final = await conflictRunner.current.run(documentId, async () => {
      const { state: extraction } = job;
      const planned =
        latestConflicts.current[documentId] ??
        (await planConflicts(
          { retriever, config: clientConfig },
          {
            documentId,
            uploader: extraction.uploader,
            documentLanguage: extraction.documentLanguage,
            document: { title: job.title, date: job.date },
            passages: Object.entries(extraction.passages).map(([id, content]) => ({ id, content })),
          },
        ));
      save(planned);
      if (planned.status === "done") return planned;
      if (accessCode === null) {
        const failed: ConflictState = { ...planned, status: "failed", error: "no_access_code" };
        save(failed);
        return failed;
      }
      return runConflicts({ db, transport: apiTransport({ accessCode }), config: clientConfig }, planned, save);
    });
    if (final?.error === "invalid_access_code") rejectAccessCode();
  }

  async function onOpenSource(passageId: string) {
    if (db === null) return;
    const ticket = sources.current.begin();
    const document = await readSource(db, identity, passageId);
    if (ticket.isCurrent()) setSource(document);
  }

  return (
    <div className="app">
      <Toolbar
        language={language}
        identity={identity}
        onIdentity={(id) => {
          discard();
          setIdentity(id);
          // 沒有 canReview 的身分看不到待審頁籤
          if (view === "review" && !access.roles.find((r) => r.id === id)?.canReview) setView("qa");
        }}
        onLanguage={(code) => (discard(), setLanguage(code))}
        onChangeAccessCode={
          accessCode === null
            ? undefined
            : () => {
                discard();
                clearAccessCode();
                setAccessCode(null);
                setCodeRejected(false);
              }
        }
      />
      {/* 第一層：底線式的導覽列（#48） */}
      <nav className="primary-tabs" aria-label={s.views}>
        {(
          [
            ["qa", s.tabQa],
            ["graph", s.tabGraph],
            ["timeline", s.tabTimeline],
            ["upload", s.tabUpload],
            ...(canReview ? ([["review", s.tabReview]] as const) : []),
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
            {label}
            {id === "review" && pending?.identity === identity && <span className="tab-count">{pending.count}</span>}
          </button>
        ))}
      </nav>
      {loadFailed ? (
        <p className="card error">{s.loadFailed}</p>
      ) : view !== "qa" ? (
        <main>
          {db === null ? (
            <p className="card muted">{s.loading}</p>
          ) : view === "graph" ? (
            <GraphPage db={db} identity={identity} language={language} onOpenSource={onOpenSource} />
          ) : view === "review" ? (
            <ReviewPage
              key={`${identity}|${language}`}
              db={db}
              identity={identity}
              language={language}
              extracting={activeExtractions.size > 0 || activeConflicts.size > 0}
              onOpenSource={onOpenSource}
              onChanged={() => setReviewVersion((v) => v + 1)}
              onGotoGraph={() => setView("graph")}
            />
          ) : view === "upload" ? (
            // 切換身分或語言時重建，清除表單、預覽與結果
            <UploadPage
              key={`${identity}|${language}`}
              db={db}
              identity={identity}
              language={language}
              onUploaded={(upload) => {
                setUploaded((ids) => new Set(ids).add(upload.documentId));
                const state = planExtraction(clientConfig, { ...upload, uploader: identity });
                const job = { title: upload.title, date: upload.date, state };
                // detect() 在萃取結束後從 ref 讀取，先寫入，不等下一次 render
                latestExtractions.current = { ...latestExtractions.current, [upload.documentId]: job };
                setExtractions((all) => ({ ...all, [upload.documentId]: job }));
                void extract(upload.documentId, state);
              }}
              extractions={Object.values(extractions)
                .filter((x) => x.state.uploader === identity)
                .map((x) => ({
                  ...x,
                  running: activeExtractions.has(x.state.documentId),
                  conflict: conflictJobs[x.state.documentId],
                  conflictRunning: activeConflicts.has(x.state.documentId),
                }))}
              onRetryExtraction={(id) => {
                const job = latestExtractions.current[id];
                if (job) void extract(id, job.state);
              }}
              onRetryConflicts={(id) => void detect(id)}
              onGoto={(target, document) => {
                if (document !== undefined) {
                  // 時間軸只列出介面語言的文件，所以切換成這份文件的語言
                  if (document.language !== language) (discard(), setLanguage(document.language));
                  setFocusDocument(document.id);
                }
                setView(target);
              }}
            />
          ) : (
            <TimelinePage
              db={db}
              identity={identity}
              language={language}
              uploaded={uploaded}
              focus={focusDocument}
              onFocused={() => setFocusDocument(null)}
              onOpenSource={onOpenSource}
            />
          )}
          {source !== null && <SourcePanel language={language} source={source} onOpenSource={onOpenSource} onClose={() => (sources.current.cancel(), setSource(null))} />}
        </main>
      ) : accessCode === null ? (
        <AccessCodeForm
          language={language}
          rejected={codeRejected}
          onSubmit={(code) => {
            saveAccessCode(code);
            setAccessCode(code);
            setCodeRejected(false);
          }}
        />
      ) : (
        <main>
          {db === null && <p className="card muted">{s.loading}</p>}
          <QuestionPanel language={language} disabled={retriever === null} onAsk={onAsk} />
          <AnswerView language={language} state={answer} onOpenSource={onOpenSource} />
          {source !== null && <SourcePanel language={language} source={source} onOpenSource={onOpenSource} onClose={() => (sources.current.cancel(), setSource(null))} />}
        </main>
      )}
    </div>
  );
}
