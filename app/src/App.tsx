// 主畫面：PGlite 在瀏覽器中載入並匯入資料集；左側導覽切換身分、語言與頁籤；問答（需要邀請碼）、圖譜、時間軸、上傳（後三者不呼叫模型）四個頁籤，
// canReview 的身分另有待審與評測台（需要邀請碼；線上 demo 不顯示評測台）；展示模式（?mode=presentation）只顯示問答與圖譜；引用跳回原文。
// 登入後的預設頁是首頁（#283；需要邀請碼，展示模式沒有首頁）。
// 問答頁是左導覽、中間對話、右側面板（原文或回答提到的實體）的三欄（#195，docs/qa.md「畫面」）。
// 手機（≤ 600px）的原文與實體面板是底部面板（#256）。
// 展示模式（#260）：左導覽換成頂端列（PresentationBar），問答頁的左欄是劇本（ScriptPanel）。
// 身分對照（#261，開關 VITE_DEMO_COMPARE）：問答頁的中間換成每個身分一欄（IdentityCompare），送出在 qa/compare.ts 的 askEach()。
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { clientConfig } from "./client/load";
import { planConflicts, runConflicts, shouldDetectConflicts, type ConflictState } from "./conflicts/run";
import { citedConflicts, readPassageMarks } from "./conflicts/marks";
import { readConflicts } from "./conflicts/store";
import { dataset } from "./dataset/load";
import { seedDataset } from "./dataset/seed";
import { openDatabase, type Database } from "./db/database";
import type { EvalRun } from "./evals/run";
import { planExtraction, runExtraction, type ExtractionState } from "./extraction/run";
import { readReview } from "./extraction/store";
import { readGraph, type Graph } from "./graph/read";
import { ask, type Answer } from "./qa/answer";
import { askEach, canStartCompare } from "./qa/compare";
import { apiTransport } from "./qa/api";
import { readMyReport, readReports, writeReport } from "./reports/store";
import { createProvider, preparesModel, PROVIDERS, type ActiveProvider, type ProgressListener } from "./retrieval/providers";
import { openRetriever } from "./retrieval/retrieve";
import { readCitedSources, readSource, type CitedSource, type SourceDocument } from "./sources/source";
import { clearAccessCode, loadAccessCode, saveAccessCode } from "./ui/access-code";
import { crossFade } from "./ui/cross-fade";
import { EntryBar } from "./ui/EntryBar";
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
import { rememberQuestion, rememberViewed, waitingSummary, type AskedQuestion, type WaitingSummary } from "./ui/home";
import { HomePage } from "./ui/HomePage";
import { createExtractionRunner } from "./ui/extraction-runner";
import { defaultView, demoCompare, evalsMode, onlineDemo, presentationMode, visibleViews, type View } from "./ui/online-demo";
import { createRequestGate } from "./ui/requests";
import { SourcePanel } from "./ui/SourcePanel";
import { SourceSheet } from "./ui/SourceSheet";
import { SessionQuestions } from "./ui/SessionQuestions";
import { sourceGraphTarget, sourceSteps } from "./ui/source-steps";
import { BottomSheet } from "./ui/BottomSheet";
import { entityOptionLabel } from "./ui/graph-labels";
import { canReport } from "./ui/report-helpers";
import { strings } from "./client/i18n";
import { TimelinePage } from "./ui/TimelinePage";
import { UploadPage } from "./ui/UploadPage";
import { Sidebar } from "./ui/Sidebar";
import { MobileNav } from "./ui/MobileNav";
import { NavRail } from "./ui/NavRail";
import { useLayout } from "./ui/layout";
import { endedExtractions, seenUploads, showsUploadDot } from "./ui/my-uploads";
import { PresentationBar, type IdentityBump } from "./ui/PresentationBar";
import { ScriptPanel } from "./ui/ScriptPanel";
import { IdentityCompare, type CompareRun } from "./ui/IdentityCompare";
import { compareColumns, compareKey, compareQuestion } from "./ui/identity-compare";
import type { AnswerState } from "./ui/AnswerView";
import { switchesIdentity, type ScriptItem } from "./ui/script";
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
  // 首頁的「問過的問題」（#283）：依身分分開，只存問題文字與提問時間（不存回答，#331）；切換身分或語言不清除，登出時清除
  const [asked, setAsked] = useState<Readonly<Record<string, readonly AskedQuestion[]>>>({});
  // 首頁的「最近看過」（#283）：依身分分開，只存實體 id（圖譜選取的、問答右側面板打開的）；名稱與能否看到在首頁以目前身分讀取。登出時清除
  const [viewed, setViewed] = useState<Readonly<Record<string, readonly string[]>>>({});
  const onViewed = (id: string) => setViewed((all) => ({ ...all, [identity]: rememberViewed(all[identity] ?? [], id) }));
  const nextTurn = useRef(0);
  const [source, setSource] = useState<SourceDocument | null>(null);
  // 原文是從哪一題的引用標號打開的（手機的「出處 N／M」，#256）；段落旁的標示與其他頁面打開時為 null
  const [sourceTurn, setSourceTurn] = useState<string | null>(null);
  // 桌機原文欄的「這次回答的出處」（#335）：sourceTurn 那一題引用到的段落；同一題換出處時沿用
  const [citedSources, setCitedSources] = useState<{ turn: string; items: CitedSource[] } | null>(null);
  // 桌機原文欄以 ✕ 關閉後，焦點回到打開它的引用標號（#335）
  const sourceOpener = useRef<HTMLElement | null>(null);
  // 手機原文面板的「回報有錯」（#256）：打開該題的回報表單（count 每次加一）
  const [reportRequest, setReportRequest] = useState<{ turn: string; count: number } | null>(null);
  // 右側面板一次顯示原文或實體其中一個；實體面板只用該題送出當下的圖譜（#195）
  const [entity, setEntity] = useState<{ graph: Graph; id: string } | null>(null);
  // 輸入框的文字（「接著問」填進來），與「在圖譜中查看」要選取的實體
  const [draft, setDraft] = useState("");
  const [graphFocus, setGraphFocus] = useState<string | null>(null);
  // 展示模式的劇本（#260 決定 3）：目前題目是最後點的劇本題，只在記憶體；劇本切換身分時頂端列的身分徽章跳一下
  const [scriptCurrent, setScriptCurrent] = useState<string | null>(null);
  // （count 換 key 重播動畫；以頂端列手動切換身分時清除，不跳）
  const [identityBump, setIdentityBump] = useState<IdentityBump | null>(null);
  // 身分對照（#261）：打開時是目前這一次對照，關閉時是 null；只在記憶體。一組請求共用 compares 的 ticket（切換題目、關閉、切換語言時取消）
  const [compare, setCompare] = useState<CompareRun | null>(null);
  const compares = useRef(createRequestGate());
  const nextCompare = useRef(0);
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
  // 手機「上傳」分頁的小點（#282）：不在上傳頁時結束的萃取（文件 id），打開上傳頁時清除目前身分的
  const [unseenUploads, setUnseenUploads] = useState<ReadonlySet<string>>(new Set());
  const lastActive = useRef(activeExtractions);
  const latestView = useRef(view);
  latestView.current = view;
  useEffect(() => {
    const ended = endedExtractions(lastActive.current, activeExtractions);
    lastActive.current = activeExtractions;
    if (ended.length > 0 && latestView.current !== "upload") setUnseenUploads((ids) => new Set([...ids, ...ended]));
  }, [activeExtractions]);
  const uploaders = Object.fromEntries(Object.values(extractions).map((x) => [x.state.documentId, x.state.uploader]));
  useEffect(() => {
    if (view === "upload") setUnseenUploads((ids) => seenUploads(ids, uploaders, identity));
    // 只在打開上傳頁或切換身分時清除（uploaders 每次 render 重建，不放進依賴）
  }, [view, identity]);
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
  const layout = useLayout();
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
    closeCompare();
    setTurnsOf(identity, () => NO_TURNS);
    setLanguage(code);
  }

  // 邀請碼被拒：清除，回到輸入畫面（#26 決定 3）；輸入框保留被拒的碼（#246）。所有身分的對話一併清掉（#303）
  function rejectAccessCode() {
    questions.current.cancel();
    closeCompare();
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

  // 切換身分：捨棄進行中的提問（discard）；目前頁籤在新身分看不到時回到問答
  function changeIdentity(id: string) {
    // 帳號登入時身分是登入的帳號，不能切換（#287）；介面上沒有選單，這裡再擋一次
    if (!canSwitchIdentity(signIn)) return;
    discard();
    setIdentity(id);
    // 沒有 canReview 的身分看不到待審與評測台頁籤（離開評測台時停止評測、關閉評測專用資料庫）；展示模式只有問答與圖譜
    if (!views(access.roles.find((r) => r.id === id)?.canReview ?? false).includes(view)) setView("qa");
  }

  // 點劇本的題目（#260）：先切到情境的身分（沿用切換身分，捨棄進行中的提問），再以該身分送出
  function onScript(item: ScriptItem) {
    if (retriever === null || accessCode === null || answering || limit !== null) return;
    if (switchesIdentity(item, identity)) {
      changeIdentity(item.role);
      setIdentityBump((last) => ({ role: item.role, count: (last?.count ?? 0) + 1 }));
    }
    setScriptCurrent(item.key);
    // 身分對照打開時：這一題換成對照的題目（取消進行中的對照），不加進對話
    if (compare !== null) void runCompare(item.text[language]);
    else void onAsk(item.text[language], item.role);
  }

  // 回答提到的實體與拒答的「可以試試」（#285）：以送出的身分讀圖譜（RLS 篩選）；讀取失敗時不列實體，拒答只給通用建議
  async function readMentions(result: Answer, owner: string): Promise<AnswerState["mentions"]> {
    const category = result.kind === "error" ? errorCategory(result.error) : null;
    const refused = result.kind === "refusal" || (result.kind === "error" && category === "modelRefusal");
    const wantsGraph = (result.kind === "answer" && !result.uncited) || refused;
    const graph = wantsGraph && db !== null ? await readGraph(db, owner).catch(() => null) : null;
    return graph === null ? undefined : { graph, entities: mentionedEntities(graph, result) };
  }

  // 桌機回答卡片的說法不同提示（#335）：以送出的身分讀段落的標示（RLS 只讓兩段都看得到的決定被讀到）；讀取失敗或引用不到兩段時不顯示
  async function readCitedConflicts(result: Answer, owner: string): Promise<AnswerState["conflicts"]> {
    if (result.kind !== "answer" || new Set(result.cited).size < 2 || db === null) return undefined;
    const marks = await db.withIdentity(owner, readPassageMarks).catch(() => null);
    return marks === null ? undefined : citedConflicts(result.numbering, result.cited, marks);
  }

  const closeCompare = () => (compares.current.cancel(), setCompare(null));

  // 身分對照（#261）：以每個身分各呼叫一次 ask()（askEach()，依身分順序一欄一欄送出），與一般提問同一條路、欄之間不共用結果。
  // 這個分頁已用完提問次數時只顯示說明、不送出（canStartCompare()）；還沒有題目時等劇本或輸入區送出
  async function runCompare(question: string | null) {
    if (retriever === null || accessCode === null) return;
    const ticket = compares.current.begin();
    const run = nextCompare.current++;
    const limited = !canStartCompare(limit);
    setCompare({ run, question, limited, answers: {}, finished: 0 });
    if (question === null || limited) return;
    const change = (next: (c: CompareRun) => CompareRun) => setCompare((c) => (c === null || c.run !== run ? c : next(c)));
    const setColumn = (index: number, state: AnswerState) => change((c) => ({ ...c, answers: { ...c.answers, [index]: state } }));
    const roles = access.roles.map((r) => r.id);
    const ctx = { retriever, transport: apiTransport({ accessCode }), model: client.model, displayName: client.displayName };
    await askEach(
      ctx,
      roles,
      { text: question, language },
      {
        onText: (index, streaming) => ticket.isCurrent() && setColumn(index, { question, streaming }),
        onAnswer: (index, result) => {
          if (!ticket.isCurrent()) return;
          if (result.kind === "error" && result.error === "invalid_access_code") return void rejectAccessCode();
          if (turnError(result) === "network") setOffline(true);
          // 今天用完了：輸入框上方的說明與一般提問相同；這一欄與之後的欄顯示額度訊息（askEach() 不再送出）
          if (result.kind === "error" && errorCategory(result.error) === "dailyLimit") setLimit(result.error);
          change((c) => ({ ...c, finished: index + 1 }));
          void readMentions(result, roles[index]).then((mentions) => ticket.isCurrent() && setColumn(index, { question, streaming: "", answer: result, mentions }));
        },
      },
      ticket.signal,
    );
  }

  // owner：送出的身分。劇本先切換身分時，這次 render 的 identity 還是切換前的，所以由呼叫端傳入
  async function onAsk(question: string, owner = identity) {
    if (retriever === null || accessCode === null || answering || limit !== null) return;
    // 以送出當下的身分與語言提問；只送出這一題的文字
    const ticket = questions.current.begin();
    const id = `turn-${nextTurn.current++}`;
    const setTurns = (change: (all: readonly Turn[]) => readonly Turn[]) => setTurnsOf(owner, change);
    const update = (turn: Turn) => setTurns((all) => all.map((t) => (t.id === id ? turn : t)));
    setTurns((all) => [...all, { id, question, streaming: "" }]);
    setAsked((all) => ({ ...all, [owner]: rememberQuestion(all[owner] ?? [], question, new Date().toISOString()) }));
    const ctx = { retriever, transport: apiTransport({ accessCode }), model: client.model, displayName: client.displayName };
    const result = await ask(
      ctx,
      { identityId: owner, text: question, language },
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
    // 以送出當下的身分讀圖譜，讀完才結束這一題，期間仍停用送出
    const mentions = await readMentions(result, owner);
    const conflicts = await readCitedConflicts(result, owner);
    if (!ticket.isCurrent()) return;
    update({ id, question, streaming: "", answer: result, mentions, conflicts });
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

  // owner：以哪個身分讀原文（身分對照的欄是該欄的身分）
  async function onOpenSource(passageId: string, turnId: string | null = null, owner = identity) {
    if (db === null) return;
    const ticket = sources.current.begin();
    if (globalThis.document.activeElement?.matches("button.citation")) sourceOpener.current = globalThis.document.activeElement as HTMLElement;
    const document = await readSource(db, owner, passageId);
    const answer = turns.find((t) => t.id === turnId)?.answer;
    const cited =
      turnId === null || answer?.kind !== "answer"
        ? null
        : // 原文欄開著、同一題換出處時沿用；重新打開時再讀（期間可能有內容被撤回）
          source !== null && citedSources?.turn === turnId
          ? citedSources
          : { turn: turnId, items: await readCitedSources(db, owner, answer.numbering, answer.cited) };
    if (ticket.isCurrent()) (setEntity(null), setSource(document), setSourceTurn(document === null ? null : turnId), setCitedSources(cited));
  }

  const closeSource = () => (sources.current.cancel(), setSource(null));
  // 桌機原文欄的 ✕：焦點回到引用標號（還在畫面上時）
  const closeSourcePanel = () => {
    closeSource();
    if (sourceOpener.current?.isConnected) sourceOpener.current.focus();
    sourceOpener.current = null;
  };

  function onOpenEntity(graph: Graph, id: string) {
    sources.current.cancel();
    setSource(null);
    setEntity({ graph, id });
  }

  // 問答右側面板打開的實體也算看過（只用該題送出當下、目前身分讀得到的圖譜）
  useEffect(() => {
    if (entity !== null) onViewed(entity.id);
  }, [entity?.id]);

  // 「這次的問題」點一題：捲到該題（手機的底部面板；桌機的左側欄不放，#330 決定 3）
  const scrollToTurn = (id: string) => void document.getElementById(id)?.scrollIntoView({ block: "start" });

  const Nav = layout === "phone" ? MobileNav : layout === "tablet" ? NavRail : Sidebar;
  // 展示模式登入後是頂端列（#260），不論寬度都取代 Nav（手機寬度的排列見 app.css），所以畫面上只有它的「問答｜圖譜」切換，
  // 不會與其他導覽同時出現
  const presentationBar = presentationMode && accessCode !== null;
  const phone = layout === "phone" && !presentationBar;
  // 平板（#255）：原文與實體從右側滑出覆蓋，不常駐右欄。展示模式沿用 1920×1080 的規格縮放（docs/design.md「平板」），不改用滑出面板
  const tablet = layout === "tablet" && !presentationBar;
  const overlay = phone || tablet;
  // 桌機登入前（#334，畫板 K-Login）：沒有左側導覽，頂端列＋登入頁；沒有導覽可以切到其他頁，所以不論目前的頁籤都顯示登入頁。
  // 平板與手機的登入頁照舊（#327）
  const desktopEntry = layout === "desktop" && accessCode === null;
  // 手機登入前（#355，畫板 K-Mobile）：沒有頂端列與底部分頁列（展示模式也一樣），登入頁自己有標示；同樣不論目前的頁籤都顯示登入頁
  const phoneEntry = layout === "phone" && accessCode === null;
  // 桌機登入後（≥ 1025px，展示模式除外）：問答頁照畫板 QA（#335）；app--desktop 讓桌機的樣式不影響手機、平板、展示模式與登入前的 app--entry
  const desktop = !overlay && !presentationBar && !desktopEntry;
  // 身分對照只在展示模式的頂端列、開關開啟時（線上 demo 一律關閉，online-demo.ts 的 demoCompare）
  const compareEnabled = presentationBar && demoCompare;
  const compareDisabled = retriever === null || answering;
  const toggleCompare = () => (compare !== null ? closeCompare() : compareDisabled ? undefined : void runCompare(compareQuestion(turns)));
  // 主持人快捷鍵 C／Esc（docs/design.md「主持人快捷鍵」）：只在問答頁、焦點不在文字輸入時；Esc 在原文或實體面板打開時交給面板。
  // 展示模式的原文卡片（#349，畫板 H-QA）：Esc 關閉，焦點回到打開它的引用標號（與「關閉」按鈕相同）；圖譜頁也是（外框自己處理的 Esc 不算）
  const compareKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  compareKeys.current = (e) => {
    if (presentationBar && source !== null && e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      return closeSourcePanel();
    }
    if (!compareEnabled || view !== "qa") return;
    const action = compareKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target: e.target instanceof Element ? (e.target as HTMLInputElement) : null }, compare !== null);
    if (action === null || (action === "close" && (source !== null || entity !== null))) return;
    e.preventDefault();
    if (action === "toggle") toggleCompare();
    else closeCompare();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => compareKeys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const canUploadAs = (role: string) => {
    const r = access.roles.find((x) => x.id === role);
    return (r?.canUpload ?? false) && views(r?.canReview ?? false).includes("upload");
  };

  // 原文與實體面板的容器依版面決定，集中在這裡（#256 決定 4）：手機是底部面板，平板是右側的滑出面板（#255），桌機是 main 中的右欄
  const side = tablet ? "right" : "bottom";
  const sourceSheet = () => {
    if (source === null) return null;
    const turn = turns.find((t) => t.id === sourceTurn);
    const answer = turn?.answer?.kind === "answer" ? turn.answer : undefined;
    // 出處 N／M 只算回答引用到的段落（cited，#256 補充決定），不是送進 prompt 的全部段落（numbering）
    const steps = answer === undefined ? null : sourceSteps(answer.cited, source.highlight);
    const target = turn?.mentions === undefined ? null : sourceGraphTarget(turn.mentions.entities, source.highlight, source.passages.map((p) => p.id));
    return (
      <SourceSheet
        language={language}
        source={source}
        steps={steps}
        onStep={(passageId) => void onOpenSource(passageId, sourceTurn)}
        onOpenSource={onOpenSource}
        onViewInGraph={target === null ? undefined : () => (closeSource(), setGraphFocus(target), setView("graph"))}
        // 展示模式不顯示「回報有錯」（#260），不能回報的題目也不顯示（與回答下方相同）
        onReport={
          turn === undefined || presentationMode || !canReport(turn)
            ? undefined
            : () => (closeSource(), setReportRequest((last) => ({ turn: turn.id, count: (last?.count ?? 0) + 1 })))
        }
        onClose={closeSource}
        side={side}
      />
    );
  };
  const sidePanel = () =>
    source === null ? null : (
      <SourcePanel
        language={language}
        source={source}
        // 從某一題的引用打開時，段落旁的標示與「這次回答的出處」都留在同一題（「原文 · 出處 N」與清單的選取）
        onOpenSource={(passageId) => void onOpenSource(passageId, sourceTurn)}
        cited={sourceTurn !== null && citedSources?.turn === sourceTurn ? citedSources.items : null}
        onClose={closeSourcePanel}
      />
    );
  const mentionPanel = (inSheet: boolean) =>
    entity !== null && (
      <MentionPanel
        graph={entity.graph}
        entityId={entity.id}
        language={language}
        onSelect={(id) => setEntity({ graph: entity.graph, id })}
        // 底部面板與滑出面板蓋住輸入區，所以手機與平板上填進輸入框或切到圖譜時一併關閉面板
        onFollowUp={(question) => (setDraft(question), inSheet && setEntity(null))}
        onViewInGraph={(id) => (setGraphFocus(id), setView("graph"), inSheet && setEntity(null))}
        onClose={() => setEntity(null)}
        inSheet={inSheet}
      />
    );
  // 手機的實體面板：高 56%（docs/design.md「實體面板」的停靠高度），平板是寬 400px 的滑出面板；名稱在面板的標題列
  const mentionEntity = entity?.graph.entities.find((e) => e.id === entity.id);
  const mentionSheet = () =>
    entity !== null &&
    mentionEntity !== undefined && (
      <BottomSheet open onClose={() => setEntity(null)} title={entityOptionLabel(entity.graph, mentionEntity, language)} language={language} className="mention-sheet" side={side}>
        {mentionPanel(true)}
      </BottomSheet>
    );
  return (
    <div className={phoneEntry ? "app app--phone app--phone-entry" : phone ? "app app--phone" : tablet ? "app app--tablet" : desktopEntry ? "app app--entry" : desktop ? "app app--desktop" : "app"}>
      {/* 只渲染一種導覽結構：展示模式登入後是頂端列，沒有「更換邀請碼」與「這次的問題」（docs/design.md「隱藏與保留」）；
          其他情況手機是頂端列＋底部分頁列、平板是左側的圖示導覽列、桌機是左側導覽（#255），桌機登入前是登入頁的頂端列（#334）。
          手機登入前沒有導覽（#355），標示在登入頁的主視覺上；平板的登入頁照常用 Nav */}
      {presentationBar ? (
        <PresentationBar
          language={language}
          identity={identity}
          onIdentity={(id) => (setIdentityBump(null), changeIdentity(id))}
          onLanguage={(code) => crossFade(() => flushSync(() => changeLanguage(code)))}
          views={views(canReview)}
          view={view}
          onView={(next) => (setGraphFocus(null), setView(next))}
          bump={identityBump}
          compare={compareEnabled ? { open: compare !== null, disabled: compare === null && compareDisabled, onToggle: toggleCompare } : undefined}
        />
      ) : desktopEntry ? (
        <EntryBar language={language} onLanguage={(code) => crossFade(() => flushSync(() => changeLanguage(code)))} />
      ) : phoneEntry ? null : (
        <Nav
          language={language}
          identity={identity}
          identityControl={identityControl(signIn)}
          account={signIn?.kind === "account" ? demoAccount(signIn.role) : undefined}
          onIdentity={changeIdentity}
          // 切換語言：原地交叉淡換（#246）；View Transitions 在回呼結束時拍下新畫面，所以同步更新
          onLanguage={(code) => crossFade(() => flushSync(() => changeLanguage(code)))}
          onChangeAccessCode={
            accessCode === null
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
            upload: phone && showsUploadDot(unseenUploads, uploaders, identity) && (
              <span className="tab-dot">
                <span className="visually-hidden">{s.uploadTabDone}</span>
              </span>
            ),
            // 手機（#358）：待審與回報都沒有（0）時「更多」與清單上不顯示數字；桌機與平板照舊顯示 0
            review: pending?.identity === identity && (!phone || pending.count > 0) && (
              <span key={bump} className={bump > 0 ? "tab-count is-bump" : "tab-count"}>
                {pending.count}
              </span>
            ),
          }}
        />
      )}
      {loadFailed ? (
        <main className="page">
          <p className="card error">{s.loadFailed}</p>
        </main>
      ) : !desktopEntry && !phoneEntry && view !== "qa" && view !== "home" && (view !== "evals" || accessCode !== null) ? (
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
              desktop={desktop}
              phone={phone}
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
          {!overlay && sidePanel()}
        </main>
      ) : accessCode === null ? (
        // 登入頁（#228、#287、#334）：左側主視覺、右側登入面板與語意模型的下載進度；窄螢幕時主視覺在上。
        // 手機（#355，畫板 K-Mobile）：主視覺左上是產品名稱與「虛構資料」，下載進度是「登入」上方的一條進度列
        <main className="entry">
          {phoneEntry && (
            <header className="entry-brand">
              <h1 className="entry-brand__name">
                {s.productName}
                <span className="visually-hidden"> / {client.displayName[language]}</span>
              </h1>
              <span className="badge entry-brand__tag">{s.fictionalData}</span>
            </header>
          )}
          <EntryHero />
          <div className="entry__panel">
            <SignInPanel
              language={language}
              identity={identity}
              rejected={rejectedCode}
              presentation={presentationMode}
              onAccount={(role, code) => onSignIn({ kind: "account", role }, code)}
              onCode={(code) => onSignIn({ kind: "code" }, code)}
              progress={phoneEntry && <RetrievalNotice language={language} preparesModel={preparesModel(client.retrieval)} status={providerStatus} bar />}
            />
            {!phoneEntry && <RetrievalNotice language={language} preparesModel={preparesModel(client.retrieval)} status={providerStatus} />}
          </div>
        </main>
      ) : view === "home" ? (
        <main className="page">
          {offline && <Notice kind="warning" title={s.qaProblems.offline} />}
          <HomePage
            db={db}
            language={language}
            identity={identity}
            wide={!phone && !tablet}
            phone={phone}
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
        <main className={overlay || (source === null && entity === null) ? "qa" : "qa with-panel"}>
          {presentationMode && (
            <ScriptPanel language={language} conversations={conversations} current={scriptCurrent} disabled={retriever === null || answering || limit !== null} onAsk={onScript} />
          )}
          <div className="qa-center">
            {/* 桌機的頁首（#335）：「每一題獨立回答」的說明從輸入框下方移到這裡 */}
            {desktop && (
              <header className="qa-header">
                <h1>{s.tabQa}</h1>
                <p className="muted">{s.qaHeaderNote}</p>
              </header>
            )}
            {offline && <Notice kind="warning" title={s.qaProblems.offline} className="notice--offline" />}
            {db === null && <p className="card muted">{s.loading}</p>}
            {/* 線上 demo：提問會傳給模型供應商（#100 計畫第 8 項） */}
            {onlineDemo.enabled && <p className="badge warning">{s.demoQaNotice}</p>}
            <RetrievalNotice language={language} preparesModel={preparesModel(client.retrieval)} status={providerStatus} compact={presentationMode} />
            {adminError !== null && <AdminNotice language={language} {...adminError} />}
            {/* 手機的「每一題獨立回答」（#354）：輸入區改成單行輸入列後，說明與桌機相同移到頂部 */}
            {phone && <p className="muted qa-phone-note">{s.qaHeaderNote}</p>}
            {/* 手機的「這次的問題」在問答頁頂部（#256 決定 1）；展示模式不顯示（#260） */}
            {phone && !presentationMode && <SessionQuestions language={language} questions={turns} onQuestion={scrollToTurn} />}
            {compareEnabled && compare !== null ? (
              <IdentityCompare
                language={language}
                columns={compareColumns(access, identity, language)}
                compare={compare}
                canUpload={canUploadAs}
                onOpenSource={(role, passageId) => void onOpenSource(passageId, null, role)}
                openPassage={source?.highlight ?? null}
                onGotoUpload={() => setView("upload")}
                onOpenEntity={onOpenEntity}
                openEntity={entity}
                onRetry={() => void runCompare(compare.question)}
                retryDisabled={compare.finished < access.roles.length}
                // 「換個問法」：對照時沒有輸入區，先關閉對照、回到一般問答的輸入列再填入
                onDraft={(question) => {
                  flushSync(() => (closeCompare(), setDraft(question)));
                  document.getElementById(QUESTION_INPUT_ID)?.focus();
                }}
                // 在圖譜看它：以該欄的身分看圖譜（切換到該身分）
                onViewInGraph={(role, id) => {
                  if (role !== identity) changeIdentity(role);
                  setGraphFocus(id);
                  setView("graph");
                }}
              />
            ) : (
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
                reportRequest={reportRequest}
                onDraft={(question) => {
                  setDraft(question);
                  document.getElementById(QUESTION_INPUT_ID)?.focus();
                }}
              />
            )}
            {/* 身分對照時隱藏輸入區（#349 決定 2）：題目從劇本選；展示模式的自由提問是與桌機相同的單行輸入列，在回答下方 */}
            {!(compareEnabled && compare !== null) && (
              <QuestionPanel
                language={language}
                disabled={retriever === null || answering}
                text={draft}
                onText={setDraft}
                onAsk={(question) => void onAsk(question)}
                limit={limit}
                presets={!presentationMode}
                // 桌機（#335，畫板 QA）、手機（#354，畫板 G-Mobile-QA）與展示模式（#349）是單行輸入列；平板照舊
                line={desktop || phone || presentationBar}
              />
            )}
          </div>
          {!overlay && sidePanel()}
          {!overlay && mentionPanel(false)}
        </main>
      )}
      {/* 手機的原文與實體面板是底部面板（#256），平板是滑出面板（#255）：原生 <dialog> 在 top layer，放在 main 之外 */}
      {overlay && sourceSheet()}
      {overlay && view === "qa" && mentionSheet()}
    </div>
  );
}
