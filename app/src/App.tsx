// 主畫面：PGlite 在瀏覽器中載入並匯入資料集；左側導覽切換身分、語言與頁籤；問答（需要邀請碼）、圖譜、時間軸、上傳（後三者不呼叫模型）四個頁籤，
// canReview 的身分另有待審與評測台（需要邀請碼；線上 demo 不顯示評測台）；展示模式（?mode=presentation）只顯示問答與圖譜；引用跳回原文。
// 登入後的預設頁是首頁（#283；需要邀請碼，展示模式沒有首頁）。
// 問答頁是左導覽、中間對話、右側面板（原文或回答提到的實體）的三欄（#195，docs/qa.md「畫面」）。
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import { readMyReport, readReports, writeReport } from "./reports/store";
import { createProvider, preparesModel, PROVIDERS, type ActiveProvider, type ProgressListener } from "./retrieval/providers";
import { openRetriever } from "./retrieval/retrieve";
import { readSource, type SourceDocument } from "./sources/source";
import { clearAccessCode, loadAccessCode, saveAccessCode } from "./ui/access-code";
import { crossFade } from "./ui/cross-fade";
import { EntryHero } from "./ui/EntryHero";
import { EvalPage } from "./ui/EvalPage";
import { GraphPage } from "./ui/GraphPage";
import { mentionedEntities } from "./ui/mentions";
import { MentionPanel } from "./ui/MentionPanel";
import { Conversation, type Turn } from "./ui/Conversation";
import { QUESTION_INPUT_ID, QuestionPanel } from "./ui/QuestionPanel";
import { AdminNotice } from "./ui/AdminNotice";
import { Notice } from "./ui/Notice";
import { errorCategory, turnError } from "./ui/qa-errors";
import { RetrievalNotice } from "./ui/RetrievalNotice";
import { reportOf } from "./ui/report-helpers";
import { PREPARING, sameDisplay, type ProviderStatus } from "./ui/retrieval-notice";
import { ReviewPage } from "./ui/ReviewPage";
import { rememberQuestion, rememberViewed, waitingSummary, type WaitingSummary } from "./ui/home";
import { HomePage } from "./ui/HomePage";
import { createExtractionRunner } from "./ui/extraction-runner";
import { defaultView, evalsMode, onlineDemo, presentationMode, visibleViews, type View } from "./ui/online-demo";
import { createRequestGate } from "./ui/requests";
import { SourcePanel } from "./ui/SourcePanel";
import { strings } from "./client/i18n";
import { TimelinePage } from "./ui/TimelinePage";
import { UploadPage } from "./ui/UploadPage";
import { Sidebar } from "./ui/Sidebar";
import { canSwitchIdentity, demoAccount, identityControl, type SignIn } from "./ui/sign-in";
import { SignInPanel, type Rejected } from "./ui/SignInPanel";

const { client, access } = clientConfig;

// 問答、比對與評測台共用一個 VectorProvider：語意模型只下載、初始化一次。App 掛載時才開始準備，不在匯入時
let sharedProvider: Promise<ActiveProvider> | null = null;
// 下載進度轉給目前掛載的 App（StrictMode 重新掛載時換成新的）
let onModelProgress: ProgressListener = () => {};
const activeProvider = () => (sharedProvider ??= createProvider(client.retrieval, PROVIDERS, (progress) => onModelProgress(progress)));

// 頁籤：導覽列與切換身分時的判斷用同一份結果（線上 demo、展示模式、評測台的網址參數都在載入時決定）
const views = (canReview: boolean) => visibleViews(canReview, onlineDemo, presentationMode, evalsMode);
// 沒有看過的實體時傳給首頁的空清單（固定同一個陣列，首頁不會因此重新讀取）
const NONE: readonly string[] = [];
// 還沒有對話的身分（固定同一個陣列）
const NO_TURNS: readonly Turn[] = [];


export function App() {
  // 登入後的預設頁是首頁，展示模式是問答（#283）；還沒登入時兩者都顯示登入頁
  const [view, setView] = useState<View>(() => defaultView(presentationMode));
  const [language, setLanguage] = useState(client.defaultLanguage);
  const [identity, setIdentity] = useState(access.roles[0].id);
  const [accessCode, setAccessCode] = useState(loadAccessCode);
  // 登入的方式（#287）：只在記憶體。帳號登入不保存任何東西，重新整理後回到登入頁；分頁中留有邀請碼時是以邀請碼體驗
  const [signIn, setSignIn] = useState<SignIn | null>(() => (accessCode === null ? null : { kind: "code" }));
  // 被拒的邀請碼：登入頁回到同一條路，保留在輸入框並顯示原因（#246）；沒有被拒時為 null
  const [rejectedCode, setRejectedCode] = useState<Rejected | null>(null);
  const [db, setDb] = useState<Database | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // 這次的問答，依序往下累積；每題獨立回答，不帶上一題（#195）。依身分分開、只在記憶體（#303）：切換身分時只顯示該身分自己的對話，
  // 切回來時看得到原本的問答；切換語言清掉目前身分的，換邀請碼、邀請碼被拒與登出清掉全部
  const [conversations, setConversations] = useState<Readonly<Record<string, readonly Turn[]>>>({});
  const turns = conversations[identity] ?? NO_TURNS;
  const setTurnsOf = (owner: string, change: (all: readonly Turn[]) => readonly Turn[]) =>
    setConversations((all) => ({ ...all, [owner]: change(all[owner] ?? NO_TURNS) }));
  // 首頁的「問過的問題」（#283）：依身分分開，只存問題文字（不存回答）；切換身分或語言不清除，登出時清除
  const [asked, setAsked] = useState<Readonly<Record<string, readonly string[]>>>({});
  // 首頁的「最近看過」（#283）：依身分分開，只存實體 id（圖譜選取的、問答右側面板打開的）；名稱與能否看到在首頁以目前身分讀取。登出時清除
  const [viewed, setViewed] = useState<Readonly<Record<string, readonly string[]>>>({});
  const onViewed = (id: string) => setViewed((all) => ({ ...all, [identity]: rememberViewed(all[identity] ?? [], id) }));
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
  // 首頁「有更新」的「查看進度」（#284）：打開上傳頁的「我的上傳」時要選取的文件
  const [uploadFocus, setUploadFocus] = useState<string | null>(null);
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
  // 「待審」頁籤的筆數（#48）：待審的實體與關係，加上待處理的說法不同（#51）與未處理的回答錯誤回報（#209）。
  // 核准、退回、處理、回報、重新整理（reviewVersion）與萃取、比對結束（activeExtractions、activeConflicts）後重新讀取。
  // 記下讀取時的身分，切換身分後不顯示前一個身分的筆數
  const canReview = access.roles.find((r) => r.id === identity)?.canReview ?? false;
  // 拒答的下一步是否列出上傳（#192）：能上傳、且上傳頁籤看得到（展示模式沒有上傳頁籤）
  const canUpload = (access.roles.find((r) => r.id === identity)?.canUpload ?? false) && views(canReview).includes("upload");
  const [reviewVersion, setReviewVersion] = useState(0);
  // 首頁的「等你處理」用同一次讀取的結果（#283），導覽列的數字是其中的 total（與 pendingCount() 相同）
  const [pending, setPending] = useState<{ identity: string; count: number; summary: WaitingSummary } | null>(null);
  // 待審數量增加時跳一下（kBump，#242 PR 3）：換 key 重播動畫；第一次讀取與切換身分時不跳
  const [bump, setBump] = useState(0);
  const lastPending = useRef(pending);
  useEffect(() => {
    const last = lastPending.current;
    lastPending.current = pending;
    if (pending !== null && last !== null && last.identity === pending.identity && pending.count > last.count) setBump((n) => n + 1);
  }, [pending]);
  // 評測台最近一次的結果（#62）：只在記憶體，切換頁籤後仍可查看與下載
  const [evalRun, setEvalRun] = useState<EvalRun | null>(null);
  // VectorProvider 的準備狀態：準備中的下載進度，與準備失敗、改用 keyword-hash 時的原因（docs/retrieval.md「準備中的提示」「降級」）
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(PREPARING);
  // 問答的錯誤（#280，docs/design.md「錯誤與額度」）：今天用完了（只記在這個分頁的記憶體，重新整理後由 Worker 決定）、
  // 需要管理者（對話區頂端，附錯誤代碼與時間）、連不到伺服器（頁面頂端，online 事件後消失）
  const [limit, setLimit] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<{ error: string; at: Date } | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!offline) return;
    const online = () => setOffline(false);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [offline]);
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
    void Promise.all([readReview(db, identity), readConflicts(db, identity), readReports(db, identity)]).then(([docs, conflicts, reports]) => {
      const summary = waitingSummary(docs, conflicts, reports);
      if (!cancelled) setPending({ identity, count: summary.total, summary });
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

  // 切換身分或語言：取消並移除進行中的回答（之後才到的結果一律忽略），清掉右側面板與輸入框（可能有「接著問」填入的實體名稱）。
  // 已完成的問答留在原本的身分（#303）；切換語言時另以 changeLanguage() 清掉
  function discard() {
    questions.current.cancel();
    sources.current.cancel();
    setTurnsOf(identity, (all) => all.filter((t) => t.answer !== undefined));
    setSource(null);
    setEntity(null);
    setDraft("");
    setGraphFocus(null);
  }

  // 切換語言：目前身分的對話是以原本的語言回答的，一併清掉（其他身分的留著）
  function changeLanguage(code: string) {
    discard();
    setTurnsOf(identity, () => NO_TURNS);
    setLanguage(code);
  }

  // 邀請碼被拒：清除，回到輸入畫面（#26 決定 3）；輸入框保留被拒的碼（#246）。所有身分的對話一併清掉（#303）
  function rejectAccessCode() {
    questions.current.cancel();
    setConversations({});
    clearAccessCode();
    setAccessCode(null);
    setRejectedCode({ code: accessCode ?? "", via: signIn?.kind === "account" ? "account" : "code" });
    // 帳號登入時回到登入頁（在問答頁籤），身分不再固定
    if (signIn?.kind === "account") setView("qa");
    setSignIn(null);
  }

  // 登入（#287）：帳號登入固定身分，邀請碼不寫入 sessionStorage；以邀請碼體驗與現行相同
  function onSignIn(next: SignIn, code: string) {
    if (next.kind === "account") (discard(), setConversations({}), setIdentity(next.role));
    else saveAccessCode(code);
    setAccessCode(code);
    setSignIn(next);
    setRejectedCode(null);
    setView(defaultView(presentationMode));
  }

  async function onAsk(question: string) {
    if (retriever === null || accessCode === null || answering || limit !== null) return;
    // 以送出當下的身分與語言提問；只送出這一題的文字
    const ticket = questions.current.begin();
    const owner = identity;
    const id = `turn-${nextTurn.current++}`;
    const setTurns = (change: (all: readonly Turn[]) => readonly Turn[]) => setTurnsOf(owner, change);
    const update = (turn: Turn) => setTurns((all) => all.map((t) => (t.id === id ? turn : t)));
    setTurns((all) => [...all, { id, question, streaming: "" }]);
    setAsked((all) => ({ ...all, [identity]: rememberQuestion(all[identity] ?? [], question) }));
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
      return;
    }
    if (turnError(result) === "network") setOffline(true);
    // 今天用完了與需要管理者：說明在輸入框上方或對話區頂端，這一題不留在對話中；問題文字回到輸入框，不搞丟
    const category = result.kind === "error" ? errorCategory(result.error) : null;
    if (result.kind === "error" && (category === "dailyLimit" || category === "admin")) {
      if (category === "dailyLimit") setLimit(result.error);
      else setAdminError({ error: result.error, at: new Date() });
      setTurns((all) => all.filter((t) => t.id !== id));
      setDraft((current) => (current === "" ? question : current));
      return;
    }
    if (result.kind !== "error") setAdminError(null);
    // 回答提到的實體與拒答的「可以試試」（#285）：以送出當下的身分讀圖譜（RLS 篩選），讀完才結束這一題，期間仍停用送出；
    // 讀取失敗時不列實體，拒答只給通用建議
    const refused = result.kind === "refusal" || (result.kind === "error" && category === "modelRefusal");
    const wantsGraph = (result.kind === "answer" && !result.uncited) || refused;
    const graph = wantsGraph && db !== null ? await readGraph(db, identity).catch(() => null) : null;
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

  // 問答右側面板打開的實體也算看過（只用該題送出當下、目前身分讀得到的圖譜）
  useEffect(() => {
    if (entity !== null) onViewed(entity.id);
  }, [entity?.id]);

  return (
    <div className="app">
      <Sidebar
        language={language}
        identity={identity}
        identityControl={identityControl(signIn)}
        account={signIn?.kind === "account" ? demoAccount(signIn.role) : undefined}
        onIdentity={(id) => {
          // 帳號登入時身分是登入的帳號，不能切換（#287）；介面上沒有選單，這裡再擋一次
          if (!canSwitchIdentity(signIn)) return;
          discard();
          setIdentity(id);
          // 沒有 canReview 的身分看不到待審與評測台頁籤（離開評測台時停止評測、關閉評測專用資料庫）；展示模式只有問答與圖譜
          if (!views(access.roles.find((r) => r.id === id)?.canReview ?? false).includes(view)) setView("qa");
        }}
        // 切換語言：原地交叉淡換（#246）；View Transitions 在回呼結束時拍下新畫面，所以同步更新
        onLanguage={(code) => crossFade(() => flushSync(() => changeLanguage(code)))}
        // 展示模式不顯示「更換邀請碼」與「這次的問題」（#260，docs/design.md「隱藏與保留」）
        onChangeAccessCode={
          accessCode === null || presentationMode
            ? undefined
            : () => {
                // 更換邀請碼；帳號登入時是「登出」，回到登入頁（#287 決定 3）
                discard();
                setConversations({});
                clearAccessCode();
                setAccessCode(null);
                if (signIn?.kind === "account") setView("qa");
                setSignIn(null);
                setRejectedCode(null);
                setAsked({});
                setViewed({});
              }
        }
        views={views(canReview)}
        view={view}
        onView={(next) => (setGraphFocus(null), setView(next))}
        tabExtra={{
          review: pending?.identity === identity && (
            <span key={bump} className={bump > 0 ? "tab-count is-bump" : "tab-count"}>
              {pending.count}
            </span>
          ),
        }}
        questions={presentationMode ? [] : turns}
        onQuestion={(id) => void document.getElementById(id)?.scrollIntoView({ block: "start" })}
      />
      {loadFailed ? (
        <main className="page">
          <p className="card error">{s.loadFailed}</p>
        </main>
      ) : view !== "qa" && view !== "home" && (view !== "evals" || accessCode !== null) ? (
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
              canSwitchIdentity={canSwitchIdentity(signIn)}
              onViewed={onViewed}
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
              onGotoUpload={canUpload ? () => setView("upload") : undefined}
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
                  if (document.language !== language) changeLanguage(document.language);
                  setFocusDocument(document.id);
                }
                setView(target);
              }}
              canSwitchIdentity={canSwitchIdentity(signIn)}
              focus={uploadFocus}
              onFocused={() => setUploadFocus(null)}
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
        // 登入頁（#228、#287）：左側主視覺、右側登入面板與語意模型的下載進度；窄螢幕時主視覺在上
        <main className="entry">
          <EntryHero />
          <div className="entry__panel">
            <SignInPanel
              language={language}
              identity={identity}
              rejected={rejectedCode}
              presentation={presentationMode}
              onAccount={(role, code) => onSignIn({ kind: "account", role }, code)}
              onCode={(code) => onSignIn({ kind: "code" }, code)}
            />
            <RetrievalNotice language={language} preparesModel={preparesModel(client.retrieval)} status={providerStatus} />
          </div>
        </main>
      ) : view === "home" ? (
        <main className="page">
          {offline && <Notice kind="warning" title={s.qaProblems.offline} />}
          <HomePage
            db={db}
            language={language}
            identity={identity}
            waiting={canReview ? (pending?.identity === identity ? pending.summary : null) : undefined}
            // 一般員工的「有更新」：不能審核的身分；自己上傳的文件（#284）與已處理的回報（#286）
            updates={!canReview ? { extracting: activeExtractions, onOpenUpload: (id) => (setUploadFocus(id), setView("upload")) } : undefined}
            asked={asked[identity] ?? []}
            askDisabled={retriever === null || answering}
            limit={limit}
            draft={draft}
            onDraft={setDraft}
            // 提問與「再問一次」都切到問答頁，以現在的身分與看得到的資料回答
            onAsk={(question) => (setView("qa"), void onAsk(question))}
            onStartReview={() => setView("review")}
            viewed={viewed[identity] ?? NONE}
            onOpenDocument={(id) => (setFocusDocument(id), setView("timeline"))}
            onOpenEntity={(id) => (setGraphFocus(id), setView("graph"))}
          />
        </main>
      ) : (
        // 中間是對話與固定在下方的輸入區，右側是原文或實體面板（關閉時中間欄變寬）
        <main className={source === null && entity === null ? "qa" : "qa with-panel"}>
          <div className="qa-center">
            {offline && <Notice kind="warning" title={s.qaProblems.offline} />}
            {db === null && <p className="card muted">{s.loading}</p>}
            {/* 線上 demo：提問會傳給模型供應商（#100 計畫第 8 項） */}
            {onlineDemo.enabled && <p className="badge warning">{s.demoQaNotice}</p>}
            <RetrievalNotice language={language} preparesModel={preparesModel(client.retrieval)} status={providerStatus} compact={presentationMode} />
            {adminError !== null && <AdminNotice language={language} {...adminError} />}
            <Conversation
              language={language}
              turns={turns}
              canUpload={canUpload}
              onOpenSource={onOpenSource}
              openPassage={source?.highlight ?? null}
              onGotoUpload={() => setView("upload")}
              onOpenEntity={onOpenEntity}
              openEntity={entity}
              // 展示模式不顯示「回報有錯」（#260，docs/design.md「隱藏與保留」）
              onReport={presentationMode ? undefined : async (turn, category, note) => {
                const report = reportOf(turn, category, note);
                // 能回報的題目一定有資料庫與回報內容（AnswerView 只在 canReport() 時顯示）；否則當作失敗
                if (db === null || report === null) throw new Error("not reportable");
                const reportId = await writeReport(db, identity, report);
                // 回答下方改顯示這則回報的結果（#286）
                setTurnsOf(identity, (all) => all.map((t) => (t.id === turn.id ? { ...t, reportId } : t)));
                // 回報的人自己能審核時，待審頁籤的筆數加一
                setReviewVersion((v) => v + 1);
              }}
              readReport={(reportId) => (db === null ? Promise.resolve(null) : readMyReport(db, identity, reportId))}
              onAsk={onAsk}
              askDisabled={retriever === null || answering || limit !== null}
              onViewInGraph={(id) => (setGraphFocus(id), setView("graph"))}
              onDraft={(question) => {
                setDraft(question);
                document.getElementById(QUESTION_INPUT_ID)?.focus();
              }}
            />
            <QuestionPanel language={language} disabled={retriever === null || answering} text={draft} onText={setDraft} onAsk={onAsk} limit={limit} />
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
