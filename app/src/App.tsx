// 主畫面：PGlite 在瀏覽器中載入並匯入資料集；左側導覽切換身分、語言與頁籤；問答（需要邀請碼）、圖譜、時間軸、上傳（後三者不呼叫模型）四個頁籤，
// canReview 的身分另有待審與評測台（需要邀請碼；線上 demo 不顯示評測台）；展示模式（?mode=presentation）只顯示問答與圖譜；引用跳回原文。
// 問答頁是左導覽、中間對話、右側面板（原文或回答提到的實體）的三欄（#195，docs/qa.md「畫面」）。
import { useEffect, useMemo, useRef, useState } from "react";
import { clientConfig } from "./client/load";
import { planConflicts, runConflicts, shouldDetectConflicts, type ConflictState } from "./conflicts/run";
import { readConflicts } from "./conflicts/store";
import { dataset } from "./dataset/load";
import { seedDataset } from "./dataset/seed";
import { openDatabase, type Database } from "./db/database";
import type { EvalRun } from "./evals/run";
import { planExtraction, runExtraction, type ExtractionState } from "./extraction/run";
import { readReview } from "./extraction/store";
import { readGraph, type Graph } from "./graph/read";
import { ask } from "./qa/answer";
import { apiTransport } from "./qa/api";
import { writeReport } from "./reports/store";
import { createProvider, preparesModel, PROVIDERS, type ActiveProvider, type ProgressListener } from "./retrieval/providers";
import { openRetriever } from "./retrieval/retrieve";
import { readSource, type SourceDocument } from "./sources/source";
import { clearAccessCode, loadAccessCode, saveAccessCode } from "./ui/access-code";
import { AccessCodeForm } from "./ui/AccessCodeForm";
import { EvalPage } from "./ui/EvalPage";
import { GraphPage } from "./ui/GraphPage";
import { mentionedEntities } from "./ui/mentions";
import { MentionPanel } from "./ui/MentionPanel";
import { Conversation, type Turn } from "./ui/Conversation";
import { QuestionPanel } from "./ui/QuestionPanel";
import { RetrievalNotice } from "./ui/RetrievalNotice";
import { reportOf } from "./ui/report-helpers";
import { PREPARING, sameDisplay, type ProviderStatus } from "./ui/retrieval-notice";
import { ReviewPage } from "./ui/ReviewPage";
import { pendingCount } from "./ui/review-helpers";
import { createExtractionRunner } from "./ui/extraction-runner";
import { evalsMode, onlineDemo, presentationMode, visibleViews, type View } from "./ui/online-demo";
import { createRequestGate } from "./ui/requests";
import { SourcePanel } from "./ui/SourcePanel";
import { strings } from "./client/i18n";
import { TimelinePage } from "./ui/TimelinePage";
import { UploadPage } from "./ui/UploadPage";
import { Sidebar } from "./ui/Sidebar";

const { client, access } = clientConfig;

// 問答、比對與評測台共用一個 VectorProvider：語意模型只下載、初始化一次。App 掛載時才開始準備，不在匯入時
let sharedProvider: Promise<ActiveProvider> | null = null;
// 下載進度轉給目前掛載的 App（StrictMode 重新掛載時換成新的）
let onModelProgress: ProgressListener = () => {};
const activeProvider = () => (sharedProvider ??= createProvider(client.retrieval, PROVIDERS, (progress) => onModelProgress(progress)));

// 頁籤：導覽列與切換身分時的判斷用同一份結果（線上 demo、展示模式、評測台的網址參數都在載入時決定）
const views = (canReview: boolean) => visibleViews(canReview, onlineDemo, presentationMode, evalsMode);


export function App() {
  const [view, setView] = useState<View>("qa");
  const [language, setLanguage] = useState(client.defaultLanguage);
  const [identity, setIdentity] = useState(access.roles[0].id);
  const [accessCode, setAccessCode] = useState(loadAccessCode);
  const [codeRejected, setCodeRejected] = useState(false);
  const [db, setDb] = useState<Database | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // 這次的問答，依序往下累積；每題獨立回答，不帶上一題（#195）
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const nextTurn = useRef(0);
  const [source, setSource] = useState<SourceDocument | null>(null);
  // 右側面板一次顯示原文或實體其中一個；實體面板只用該題送出當下的圖譜（#195）
  const [entity, setEntity] = useState<{ graph: Graph; id: string } | null>(null);
  // 輸入框的文字（「接著問」填進來），與「在圖譜中查看」要選取的實體
  const [draft, setDraft] = useState("");
  const [graphFocus, setGraphFocus] = useState<string | null>(null);
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
  // 拒答的下一步是否列出上傳（#192）：能上傳、且上傳頁籤看得到（展示模式沒有上傳頁籤）
  const canUpload = (access.roles.find((r) => r.id === identity)?.canUpload ?? false) && views(canReview).includes("upload");
  const [reviewVersion, setReviewVersion] = useState(0);
  const [pending, setPending] = useState<{ identity: string; count: number } | null>(null);
  // 評測台最近一次的結果（#62）：只在記憶體，切換頁籤後仍可查看與下載
  const [evalRun, setEvalRun] = useState<EvalRun | null>(null);
  // VectorProvider 的準備狀態：準備中的下載進度，與準備失敗、改用 keyword-hash 時的原因（docs/retrieval.md「準備中的提示」「降級」）
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(PREPARING);
  const s = strings(language);
  // 回答串流中：停用送出與預設問題，不以新提問中斷前一題（#195 決定 3）
  const answering = turns.some((t) => t.answer === undefined);

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

  useEffect(() => {
    let cancelled = false;
    onModelProgress = (progress) => {
      const next: ProviderStatus = { state: "preparing", progress };
      setProviderStatus((current) => (sameDisplay(current, next) ? current : next));
    };
    void activeProvider().then((active) => !cancelled && setProviderStatus({ state: "ready", fallback: active.fallback }));
    return () => {
      cancelled = true;
      onModelProgress = () => {};
    };
  }, []);

  const retriever = useMemo(() => (db === null ? null : openRetriever(db, client.retrieval, activeProvider())), [db]);

  // 切換身分或語言：清掉對話、右側面板與輸入框（可能有「接著問」填入的實體名稱），之後才到的結果一律忽略
  function discard() {
    questions.current.cancel();
    sources.current.cancel();
    setTurns([]);
    setSource(null);
    setEntity(null);
    setDraft("");
    setGraphFocus(null);
  }

  // 邀請碼被拒：清除，回到輸入畫面（#26 決定 3）
  function rejectAccessCode() {
    clearAccessCode();
    setAccessCode(null);
    setCodeRejected(true);
  }

  async function onAsk(question: string) {
    if (retriever === null || accessCode === null || answering) return;
    // 以送出當下的身分與語言提問；只送出這一題的文字
    const ticket = questions.current.begin();
    const id = `turn-${nextTurn.current++}`;
    const update = (turn: Turn) => setTurns((all) => all.map((t) => (t.id === id ? turn : t)));
    setTurns((all) => [...all, { id, question, streaming: "" }]);
    const ctx = { retriever, transport: apiTransport({ accessCode }), model: client.model, displayName: client.displayName };
    const result = await ask(
      ctx,
      { identityId: identity, text: question, language },
      (streaming) => ticket.isCurrent() && update({ id, question, streaming }),
      ticket.signal,
    );
    if (!ticket.isCurrent()) return;
    if (result.kind === "error" && result.error === "invalid_access_code") {
      rejectAccessCode();
      setTurns((all) => all.filter((t) => t.id !== id));
      return;
    }
    // 回答提到的實體：以送出當下的身分讀圖譜（RLS 篩選），讀完才結束這一題，期間仍停用送出；讀取失敗時不列
    const graph = result.kind === "answer" && !result.uncited && db !== null ? await readGraph(db, identity).catch(() => null) : null;
    if (!ticket.isCurrent()) return;
    const mentions = graph === null ? undefined : { graph, entities: mentionedEntities(graph, result) };
    update({ id, question, streaming: "", answer: result, mentions });
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
    if (ticket.isCurrent()) (setEntity(null), setSource(document));
  }

  function onOpenEntity(graph: Graph, id: string) {
    sources.current.cancel();
    setSource(null);
    setEntity({ graph, id });
  }

  return (
    <div className="app">
      <Sidebar
        language={language}
        identity={identity}
        onIdentity={(id) => {
          discard();
          setIdentity(id);
          // 沒有 canReview 的身分看不到待審與評測台頁籤（離開評測台時停止評測、關閉評測專用資料庫）；展示模式只有問答與圖譜
          if (!views(access.roles.find((r) => r.id === id)?.canReview ?? false).includes(view)) setView("qa");
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
        views={views(canReview)}
        view={view}
        onView={(next) => (setGraphFocus(null), setView(next))}
        tabExtra={{ review: pending?.identity === identity && <span className="tab-count">{pending.count}</span> }}
        questions={turns}
        onQuestion={(id) => void document.getElementById(id)?.scrollIntoView({ block: "start" })}
      />
      {loadFailed ? (
        <main className="page">
          <p className="card error">{s.loadFailed}</p>
        </main>
      ) : view !== "qa" && (view !== "evals" || accessCode !== null) ? (
        <main className="page">
          {db === null ? (
            <p className="card muted">{s.loading}</p>
          ) : view === "graph" ? (
            <GraphPage
              db={db}
              identity={identity}
              language={language}
              onOpenSource={onOpenSource}
              // 在問答中問（#199）：填進輸入框並切到問答頁，不送出
              onAskAbout={(question) => (setDraft(question), setView("qa"))}
              canReview={canReview}
              onRetracted={() => setReviewVersion((v) => v + 1)}
              initialSelected={graphFocus}
            />
          ) : view === "evals" ? (
            <EvalPage
              language={language}
              accessCode={accessCode ?? ""}
              uploadedCount={uploaded.size}
              provider={activeProvider()}
              status={providerStatus}
              run={evalRun}
              onRun={setEvalRun}
              onRejectAccessCode={rejectAccessCode}
            />
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
              onViewInGraph={(id) => (setGraphFocus(id), setView("graph"))}
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
        <main className="page">
          <AccessCodeForm
            language={language}
            rejected={codeRejected}
            onSubmit={(code) => {
              saveAccessCode(code);
              setAccessCode(code);
              setCodeRejected(false);
            }}
          />
        </main>
      ) : (
        // 中間是對話與固定在下方的輸入區，右側是原文或實體面板（關閉時中間欄變寬）
        <main className={source === null && entity === null ? "qa" : "qa with-panel"}>
          <div className="qa-center">
            {db === null && <p className="card muted">{s.loading}</p>}
            {/* 線上 demo：提問會傳給模型供應商（#100 計畫第 8 項） */}
            {onlineDemo.enabled && <p className="badge warning">{s.demoQaNotice}</p>}
            <RetrievalNotice language={language} preparesModel={preparesModel(client.retrieval)} status={providerStatus} />
            <Conversation
              language={language}
              turns={turns}
              canUpload={canUpload}
              onOpenSource={onOpenSource}
              onGotoUpload={() => setView("upload")}
              onOpenEntity={onOpenEntity}
              openEntity={entity}
              onReport={async (turn, category, note) => {
                const report = reportOf(turn, category, note);
                // 能回報的題目一定有資料庫與回報內容（AnswerView 只在 canReport() 時顯示）；否則當作失敗
                if (db === null || report === null) throw new Error("not reportable");
                await writeReport(db, identity, report);
              }}
            />
            <QuestionPanel language={language} disabled={retriever === null || answering} text={draft} onText={setDraft} onAsk={onAsk} />
          </div>
          {source !== null && <SourcePanel language={language} source={source} onOpenSource={onOpenSource} onClose={() => (sources.current.cancel(), setSource(null))} />}
          {entity !== null && (
            <MentionPanel
              graph={entity.graph}
              entityId={entity.id}
              language={language}
              onSelect={(id) => setEntity({ graph: entity.graph, id })}
              onFollowUp={setDraft}
              onViewInGraph={(id) => (setGraphFocus(id), setView("graph"))}
              onClose={() => setEntity(null)}
            />
          )}
        </main>
      )}
    </div>
  );
}
