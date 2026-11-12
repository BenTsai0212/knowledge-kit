// 待審頁（#44，docs/extraction.md「畫面」）：只有 canReview 的身分看得到。依文件列出待審的實體與關係，
// 每份文件開頭是摘要與進度，需要確認的組在最上面，系統已準備的收合成一行（#189，分組在 review-helpers.ts 的 reviewGroups()）；
// 可以修改名稱、選擇合併對象、確認一組、核准整份文件、退回；另有「已退回」分頁。
// 設計系統 v1（#243）：底線式分頁、文件卡片的頁首（右側是待確認的組數與「核准這份文件的全部」）、textMuted 的組名，
// 沒有需要確認項目的文件可以收合。合併選擇是列內展開的兩張單選卡（合併到既有實體、建立新實體）；名稱缺少語言時列加 warning 細框、
// 展開各語言的名稱欄位；說法不同兩種說法並排、下方三個決定按鈕。窄螢幕的分頁單行、橫向捲動。
// 列的動態（#243 PR 3，review-motion.ts）：逐列升起；合併選擇列內展開並畫出連線；核准一筆時列收合、退回往左淡出，
// 動畫播完才寫入；撤銷時列在原位重新展開、短提示原地換掉文字。
// #243 PR 4：核准全部時各列依序往右離開、結果在短提示中彈出；說法不同「並存」兩卡之間畫出等號、兩邊標上關聯，
// 「取代」舊說法變淡、刪除線由左畫到右，同樣播完才寫入。
// 每筆一行，按「編輯名稱」才可以修改；出處點開才顯示，預設 2 行、標出實體名稱；核准或退回後顯示短提示（#48），附「撤銷」（ADR 0007 決定 4）。
// 每份文件另有「說法不同」區塊（#51）：新舊段落並列、三選一處理；已處理的在「已處理的說法不同」分頁。
// 「回報」分頁是問答的回答錯誤回報（ADR 0007 決定 7，ReportList.tsx）。
// 讀取與寫入都經 store.ts、conflicts/store.ts（RLS 決定看得到、能核准什麼）；模型輸出一律以文字節點顯示。
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { clientConfig } from "../client/load";
import type { LocalizedText } from "../client/types";
import { decideConflict, readConflicts, type ConflictDecision, type ConflictItem, type ConflictPassage } from "../conflicts/store";
import type { Database } from "../db/database";
import { suggestMerge, type MergeSuggestion } from "../extraction/merge";
import { approve, readReview, reject, retract, ReviewError, type EntityApproval, type ReviewDocument, type ReviewEntity, type ReviewRelation } from "../extraction/store";
import { readGraph, type Graph } from "../graph/read";
import { readReports, type AnswerReport } from "../reports/store";
import { AccessBadges } from "./AccessBadges";
import { entityOptionLabel, entityTypeLabel, relationTypeLabel } from "./graph-labels";
import { Notice } from "./Notice";
import { EmptyState } from "./EmptyState";
import { ReportList } from "./ReportList";
import { createRequestGate } from "./requests";
import {
  batchPlan,
  canBatch,
  choiceCard,
  choiceShown,
  docCollapsible,
  entityMark,
  groupPlan,
  highlightSegments,
  initialChoice,
  inputSize,
  mergeCandidates,
  missingNameLanguages,
  nextTab,
  reviewDocuments,
  reviewGroups,
  reviewTabCounts,
  toastText,
  waitingRelations,
  type EntityChoice,
} from "./review-helpers";
import { fill, strings } from "../client/i18n";
import { createToastTimer, type ToastTimer } from "./toast-timer";
import { REDUCED_MOTION, staggerIndex } from "./motion";
import { conflictSettleDelay, exitOrder, exitThenWrite, resultDelay, rowClass, rowExitDelay, withExit, type RowExit } from "./review-motion";
import { entityTypeShape } from "./timeline-view";

interface Props {
  db: Database;
  identity: string;
  language: string;
  // 有萃取還在進行時顯示提示
  extracting: boolean;
  onOpenSource(passageId: string): void;
  // 核准、退回或重新整理後通知 App 更新頁籤的待審筆數
  onChanged(): void;
  onGotoGraph(): void;
  // 待審清空時的「再上傳一份」；目前身分不能上傳時不傳（#245）
  onGotoUpload?(): void;
  // 回報中的實體：切到圖譜頁並選取該實體
  onViewInGraph(entityId: string): void;
}

// 撤銷的對象：決定 id 與這次寫入的項目 id（撤銷後這些列在原位重新展開，#243）
type UndoTarget = { docId: string; decisions: string[]; items: string[] };

const prefersReducedMotion = () => window.matchMedia?.(REDUCED_MOTION).matches ?? false;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// 短提示自動消失的時間；滑鼠停在提示上或焦點在提示內時暫停（toast-timer.ts，#48 審查）
const TOAST_MS = 10_000;

const { client, knowledgeModel } = clientConfig;

// 說法不同的三種處理方式（#51 決定 4），依按鈕的順序
const CONFLICT_DECISIONS: readonly ConflictDecision[] = ["coexist", "supersede", "not_conflict"];

// 第二層分頁（#243：底線式，role="tablist"）。decided：已處理的說法不同（#51）；reports：回答錯誤回報（ADR 0007）
const TABS = ["pending", "rejected", "decided", "reports"] as const;
type Tab = (typeof TABS)[number];

const typeColor = (type: string) => knowledgeModel.entityTypes.find((t) => t.id === type)?.color ?? "var(--color-graphFallback)";

// 待審實體沒有主要名稱（name），依介面語言取 names
const pendingName = (e: ReviewEntity, language: string) => e.names[language] || Object.values(e.names)[0] || e.id;

export function ReviewPage({ db, identity, language, extracting, onOpenSource, onChanged, onGotoGraph, onGotoUpload, onViewInGraph }: Props) {
  const s = strings(language);
  const [tab, setTab] = useState<Tab>("pending");
  const ids = useId();
  const [docs, setDocs] = useState<ReviewDocument[] | null>(null);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [reports, setReports] = useState<AnswerReport[]>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [choices, setChoices] = useState<Record<string, EntityChoice>>({});
  // 核准或退回的錯誤、批次核准時因名稱不完整而略過的筆數；顯示在該文件的卡片上方（#48）
  const [notice, setNotice] = useState<{ docId: string; error?: string; skipped?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // 正在編輯名稱的實體、展開的出處（項目 id 與段落 id）、核准或退回後的短提示
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // 點開出處的項目 id（#189：每筆一行，出處點開才顯示）
  const [openSources, setOpenSources] = useState<ReadonlySet<string>>(new Set());
  // 按下「變更合併對象」、展開單選卡的實體（系統建議與自動合併；需要逐筆決定的一直展開，#243）
  const [openChoices, setOpenChoices] = useState<ReadonlySet<string>>(new Set());
  // 文件卡片的收合（#243）：沒有需要確認項目的文件預設收合。預設值在第一次出現時決定並記住，
  // 確認完最後一組時不會在眼前收起來；按下「展開」「收合」後以 openDocs 為準
  const [openDocs, setOpenDocs] = useState<Record<string, boolean>>({});
  const firstOpen = useRef(new Map<string, boolean>());
  // graph：附「到圖譜查看」（只有核准；退回的項目不會出現在圖譜）。undo：這次寫入的決定，附「撤銷」（ADR 0007 決定 4）。
  // id 每次遞增，當作 key：文字與上一次相同時也重新掛載，重新播放進場動畫（#48 審查第 2 次）
  // 撤銷時文字原地換掉、id 不變，不重新掛載（#243）
  // result：核准全部的結果，文字彈出（kPopS），值是延遲的毫秒數（review-motion.ts 的 resultDelay，#243 PR 4）
  const [toast, setToast] = useState<{ id: number; text: string; graph: boolean; undo?: UndoTarget; result?: number } | null>(null);
  const toastId = useRef(0);
  const toastTimer = useRef<ToastTimer | null>(null);
  // 連點時 state 還沒更新，以 ref 確保同時只有一個核准或退回在進行（比照 #42）
  const working = useRef(false);
  // 列的動態（#243，review-motion.ts）：離開中的列（核准收合、退回往左淡出）留到新的資料讀回來；
  // 撤銷後回到待審的列重新展開。restored 不清空：換 class 會讓列重播逐列升起，列離開時自然卸載
  const [leaving, setLeaving] = useState<ReadonlyMap<string, RowExit>>(new Map());
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set());
  // 說法不同正在播放的決定（並存、取代，#243 PR 4）：播完才寫入，新的資料讀回來時清空
  const [settling, setSettling] = useState<ReadonlyMap<string, ConflictDecision>>(new Map());
  const reads = useRef(createRequestGate());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const ticket = reads.current.begin();
    void Promise.all([readReview(db, identity), readGraph(db, identity), readConflicts(db, identity), readReports(db, identity)]).then(([d, g, c, r]) => {
      if (!ticket.isCurrent()) return;
      setDocs(reviewDocuments(d, c));
      setLeaving(new Map());
      setSettling(new Map());
      setConflicts(c);
      setGraph(g);
      setReports(r);
    });
    return () => reads.current.cancel();
  }, [db, identity, version]);

  useEffect(() => {
    if (toast === null) return;
    const timer = createToastTimer(TOAST_MS, () => setToast(null));
    toastTimer.current = timer;
    return () => {
      timer.cancel();
      toastTimer.current = null;
    };
  }, [toast]);

  if (docs === null || graph === null) return <p className="card muted">{s.loading}</p>;

  const suggestions: Record<string, MergeSuggestion> = Object.fromEntries(
    docs.flatMap((d) => d.entities).map((e) => [e.id, suggestMerge(e, graph.entities, knowledgeModel.entityTypes)]),
  );
  const choiceOf = (e: ReviewEntity) => choices[e.id] ?? initialChoice(suggestions[e.id]);
  const allChoices = Object.fromEntries(docs.flatMap((d) => d.entities).map((e) => [e.id, choiceOf(e)]));
  const setChoice = (id: string, choice: EntityChoice) => setChoices((c) => ({ ...c, [id]: choice }));
  const flip = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  const counts = reviewTabCounts(docs, conflicts, reports);
  const tabLabels: Record<Tab, string> = { pending: s.reviewPendingTab, rejected: s.reviewRejectedTab, decided: s.reviewDecidedTab, reports: s.reviewReportsTab };
  // 窄螢幕的分頁橫向捲動（#243）：選中的分頁捲進可見範圍
  const selectTab = (next: Tab) => {
    setTab(next);
    document.getElementById(`${ids}-tab-${next}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  // 左右鍵、Home、End 切換分頁並把焦點移過去（只有選中的分頁在 Tab 順序中）
  const tabKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTab(TABS, tab, ev.key);
    if (next === null) return;
    ev.preventDefault();
    selectTab(next);
    document.getElementById(`${ids}-tab-${next}`)?.focus();
  };
  const languageNames = new Intl.DisplayNames([language], { type: "language" });

  // done：成功後的短提示；undoable 時 action 回傳的決定 id 交給「撤銷」。
  // motion（#243）：exit 是要退場的列與方式（先播完再寫入，失敗時列回到原狀），items 是這次寫入的項目（撤銷時重新展開），
  // restore 是撤銷後回到待審的列；inPlace 時短提示原地換掉文字、不重新掛載。
  // conflict 是說法不同的決定（播完才寫入）；result 時短提示的文字是核准全部的結果，彈出（#243 PR 4）
  async function run(
    docId: string,
    action: () => Promise<string[] | void>,
    done: { text: string; graph: boolean; undoable?: boolean },
    skipped = 0,
    motion: {
      exit?: { ids: string[]; kind: RowExit };
      conflict?: { id: string; decision: ConflictDecision };
      result?: boolean;
      items?: string[];
      restore?: string[];
      inPlace?: boolean;
    } = {},
  ) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice(skipped > 0 ? { docId, skipped } : null);
    if (!motion.inPlace) setToast(null);
    const { exit, conflict } = motion;
    const reduced = prefersReducedMotion();
    const delay =
      exit !== undefined ? rowExitDelay(reduced, exit.kind, exit.ids.length) : conflict !== undefined ? conflictSettleDelay(reduced, conflict.decision) : 0;
    // 說法不同的動畫：標上（decision）或還原（null）
    const settle = (decision: ConflictDecision | null) => {
      if (conflict === undefined) return;
      setSettling((cur) => {
        const next = new Map(cur);
        if (decision === null) next.delete(conflict.id);
        else next.set(conflict.id, decision);
        return next;
      });
    };
    try {
      const decisions = await exitThenWrite({
        delay,
        wait,
        mark: () => {
          if (exit !== undefined) setLeaving((cur) => withExit(cur, exit.ids, exit.kind));
          if (conflict !== undefined && delay > 0) settle(conflict.decision);
        },
        restore: () => {
          if (exit !== undefined) setLeaving((cur) => withExit(cur, exit.ids, null));
          settle(null);
        },
        write: action,
      });
      const undo = done.undoable && Array.isArray(decisions) && decisions.length > 0 ? { docId, decisions, items: motion.items ?? [] } : undefined;
      const back = motion.restore;
      if (back !== undefined) setRestored((cur) => new Set([...cur, ...back]));
      const result = motion.result ? resultDelay(reduced, delay) : undefined;
      setToast((cur) => ({ text: done.text, graph: done.graph, undo, result, id: motion.inPlace && cur !== null ? cur.id : ++toastId.current }));
    } catch (e) {
      setNotice({ docId, skipped, error: e instanceof ReviewError ? s.reviewErrors[e.reason] : s.unknownError });
    } finally {
      working.current = false;
      setBusy(false);
      refresh();
    }
  }
  // skippedCount：批次核准時因名稱不完整而略過的筆數（逐筆核准時為 0，清除先前的提示）
  // exitIds：核准時收合的列（一組或一筆，#243）；all：「核准這份文件的全部」，各列依序往右離開、結果彈出（#243 PR 4）
  const approveItems = (
    docId: string,
    items: { entities: EntityApproval[]; relations: string[]; existingRelations?: string[] },
    skippedCount = 0,
    exitIds: string[] = [],
    all = false,
  ) =>
    run(
      docId,
      () => approve(db, identity, items, { defaultLanguage: client.defaultLanguage }),
      {
        text: toastText(
          { one: s.reviewToastApprovedOne, many: s.reviewToastApproved },
          itemLabels(docId, items.entities.map((e) => e.id), [...items.relations, ...(items.existingRelations ?? [])]),
        ),
        graph: true,
        undoable: true,
      },
      skippedCount,
      {
        exit: exitIds.length > 0 ? { ids: exitIds, kind: all ? "away" : "collapse" } : undefined,
        result: all,
        items: [...items.entities.map((e) => e.id), ...items.relations, ...(items.existingRelations ?? [])],
      },
    );
  const approveBatch = (docId: string, plan: ReturnType<typeof batchPlan>, exitIds: string[] = []) =>
    void approveItems(docId, { entities: plan.entities, relations: plan.relations, existingRelations: plan.existingRelations }, plan.skipped, exitIds);
  // 核准這份文件的全部：計畫中的每一列依文件中的順序往右離開
  const approveAll = (docId: string, plan: ReturnType<typeof batchPlan>) =>
    void approveItems(
      docId,
      { entities: plan.entities, relations: plan.relations, existingRelations: plan.existingRelations },
      plan.skipped,
      [...plan.entities.map((e) => e.id), ...plan.relations, ...plan.existingRelations],
      true,
    );
  // 退回：列往左淡出（#243）
  const rejectItems = (docId: string, items: { entities: string[]; relations: string[] }) => {
    const ids = [...items.entities, ...items.relations];
    return run(
      docId,
      () => reject(db, identity, items),
      {
        text: toastText({ one: s.reviewToastRejectedOne, many: s.reviewToastRejected }, itemLabels(docId, items.entities, items.relations)),
        graph: false,
        undoable: true,
      },
      0,
      { exit: { ids, kind: "out" }, items: ids },
    );
  };
  // 撤銷：撤回剛寫入的每一筆決定（退回時含一併退回的關係），項目回到待審、列在原位重新展開；短提示原地換掉文字（#243）
  const undo = (target: UndoTarget) =>
    void run(target.docId, () => retract(db, identity, target.decisions), { text: s.reviewToastUndone, graph: false }, 0, { restore: target.items, inPlace: true });
  // 列（li）的 class 與依序出現的格數（#243）：逐列升起，第 7 列起不再延遲；--o 是往右離開的第幾個（#243 PR 4）
  const itemProps = (id: string, index: number) => ({
    className: rowClass(id, leaving, restored),
    style: { "--i": staggerIndex(index), ...(leaving.get(id) === "away" && { "--o": exitOrder(leaving, id) }) } as CSSProperties,
  });

  const nameOf = (doc: ReviewDocument, id: string) => {
    const e = doc.entities.find((x) => x.id === id);
    return e ? (choiceOf(e).names?.[language] ?? pendingName(e, language)) : id;
  };
  // 短提示中的項目名稱：實體是介面語言的名稱，關係是「起點 —關係→ 終點」（與卡片相同）
  const itemLabels = (docId: string, entities: string[], relations: string[]) => {
    const doc = docs.find((d) => d.id === docId);
    if (doc === undefined) return [...entities, ...relations];
    const relationLabel = (id: string) => {
      const r = doc.relations.find((x) => x.id === id);
      return r ? `${nameOf(doc, r.from)} —${relationTypeLabel(r.type, language)}→ ${nameOf(doc, r.to)}` : id;
    };
    return [...entities.map((id) => nameOf(doc, id)), ...relations.map(relationLabel)];
  };
  // 出處段落：預設 2 行、可以展開，以文件語言的名稱標出實體（#48）
  const sourceList = (doc: ReviewDocument, itemId: string, sources: ReviewEntity["sources"], entityIds: string[]) => {
    const terms = entityIds.map((id) => doc.entities.find((e) => e.id === id)?.names[doc.language] ?? "");
    return (
      <ul className="review-sources">
        {sources.map((p) => {
          const key = `${itemId}|${p.id}`;
          const open = expanded.has(key);
          return (
            <li key={p.id}>
              <span lang={p.language} className={open ? "review-source" : "review-source clamped"}>
                {highlightSegments(p.content, terms).map((seg, i) => (seg.mark ? <mark key={i}>{seg.text}</mark> : <Fragment key={i}>{seg.text}</Fragment>))}
              </span>
              <span className="review-source-actions">
                <button type="button" className="link" aria-expanded={open} onClick={() => setExpanded((cur) => flip(cur, key))}>
                  {open ? s.reviewCollapse : s.reviewExpand}
                </button>
                <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
                  {s.openSource}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    );
  };
  // 每份文件在目前分頁要列出的說法不同：待審分頁是待處理的，已處理分頁是已處理的
  const conflictsOf = (docId: string) =>
    conflicts.filter((c) => c.documentId === docId && (tab === "pending" ? c.decision === null : tab === "decided" && c.decision !== null));
  const itemStatus = tab === "pending" ? "pending" : tab === "rejected" ? "rejected" : null;
  // 回報分頁沒有文件：itemStatus 是 null，conflictsOf() 也是空的
  const visibleDocs = docs.filter((d) => [...d.entities, ...d.relations].some((x) => x.status === itemStatus) || conflictsOf(d.id).length > 0);
  // 並存與取代先播完動畫才寫入（#243 PR 4）
  const decide = (docId: string, conflictId: string, decision: ConflictDecision) =>
    void run(
      docId,
      () => decideConflict(db, identity, conflictId, decision),
      { text: toastText({ one: s.conflictToast, many: s.conflictToast }, [s.conflictDecisions[decision]]), graph: false },
      0,
      { conflict: { id: conflictId, decision } },
    );
  // 新舊說法的一側：說法（文件的語言），下方是出處（文件標題、等級與專案的標籤、日期）與「打開原文」。
  // linked：並存時標上的關聯（第幾側、另一側的說法），文字與時間軸的段落標示相同、依序升起；
  // superseded：取代時舊說法變淡、刪除線由左畫到右（#243 PR 4）
  const conflictSide = (label: string, p: ConflictPassage, opts: { linked?: { index: number; other: ConflictPassage }; superseded?: boolean } = {}) => (
    <div className={opts.superseded ? "conflict-side is-superseded" : "conflict-side"}>
      <h4>
        {label}
        {opts.linked !== undefined && (
          <span className="conflict-linked" style={{ "--i": opts.linked.index } as CSSProperties}>
            {fill(s.conflictMarks.conflict, { title: opts.linked.other.documentTitle }, language)}
          </span>
        )}
      </h4>
      <p className="conflict-content" lang={p.language}>
        {p.content}
        {opts.superseded && <span className="conflict-strike" aria-hidden="true" />}
      </p>
      <p className="conflict-source">
        <span lang={p.language}>{p.documentTitle}</span> <AccessBadges visibility={p.visibility} project={p.project} language={language} />{" "}
        <time className="muted" dateTime={p.date ?? undefined}>
          {p.date ?? s.undated}
        </time>{" "}
        <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
          {s.openSource}
        </button>
      </p>
    </div>
  );

  // 出處的開關：每筆一行，出處點開才顯示（#189）
  const sourcesToggle = (itemId: string, count: number) =>
    count > 0 && (
      <button type="button" className="link" aria-expanded={openSources.has(itemId)} onClick={() => setOpenSources((cur) => flip(cur, itemId))}>
        {fill(s.reviewSources, { count }, language)}
      </button>
    );
  // 實體列的標示（#243）：新增、自動合併、系統建議；需要逐筆決定的沒有標示
  const markLabels = { new: s.reviewNew, auto: s.reviewAutoMerged, suggested: s.reviewSuggested };
  // 一筆實體一行（#189、#243）：類型的形狀與名稱、名稱、標示、出處數，最後是退回與核准。
  // 合併選擇在列下方展開成兩張單選卡（choiceShown），選擇合併時下方提示可見範圍；名稱缺少語言時整列 warning 細框、展開名稱欄位。
  // confirm：「確認」一組或「核准」一筆（沒有時只有退回），confirmLabel 寫明一起核准的關係數
  const entityRow = (doc: ReviewDocument, e: ReviewEntity, opts: { confirm?: () => void; confirmLabel?: string; confirmDisabled?: boolean }) => {
    const pending = e.status === "pending";
    const suggestion = suggestions[e.id];
    const mark = pending ? entityMark(suggestion) : null;
    const choice = choiceOf(e);
    const candidates = mergeCandidates(suggestion);
    const needsChoice = !canBatch(suggestion);
    const shown = pending && choiceShown(suggestion, openChoices.has(e.id));
    const card = choiceCard(choice);
    const names: LocalizedText = choice.names ?? e.names;
    // 只有建立新實體的項目可以編輯名稱（#44 決定 4）；名稱缺少語言時一直顯示輸入框
    const editable = pending && choice.mergeInto === null;
    const missing = editable ? missingNameLanguages(names, client.languages) : [];
    const isEditing = editable && (editing.has(e.id) || missing.length > 0);
    const choiceId = `${ids}-choice-${e.id}`;
    const pick = (mergeInto: string | null) => setChoice(e.id, { ...choice, mergeInto });
    return (
      <div className={missing.length > 0 ? "review-entity is-warning" : "review-entity"}>
        <div className="review-row">
          <span className={`entity-badge shape-${entityTypeShape(e.type)}`} style={{ "--type-color": typeColor(e.type) } as CSSProperties}>
            <span className="type-dot" aria-hidden="true" />
            {entityTypeLabel(e.type, language)}
          </span>
          {isEditing ? (
            <span className="review-names editing">
              {client.languages.map((l) => (
                <label key={l} className="inline">
                  {languageNames.of(l) ?? l}
                  {missing.includes(l) && <span className="review-required">{s.reviewRequired}</span>}
                  <input
                    type="text"
                    lang={l}
                    value={names[l] ?? ""}
                    size={inputSize(names[l] ?? "")}
                    required
                    aria-invalid={missing.includes(l)}
                    disabled={busy}
                    onChange={(ev) => setChoice(e.id, { ...choice, names: { ...names, [l]: ev.target.value } })}
                  />
                </label>
              ))}
              <button type="button" className="secondary" disabled={busy || missing.length > 0} onClick={() => setEditing((cur) => flip(cur, e.id))}>
                {s.reviewEditDone}
              </button>
            </span>
          ) : (
            <span className="review-names">
              {client.languages.map((l, i) => (
                <Fragment key={l}>
                  {i > 0 && " / "}
                  <span lang={l}>{(choice.mergeInto === null ? names : e.names)[l]}</span>
                </Fragment>
              ))}
              {editable && (
                <button type="button" className="link" disabled={busy} onClick={() => setEditing((cur) => flip(cur, e.id))}>
                  {s.reviewEditNames}
                </button>
              )}
            </span>
          )}
          {mark !== null && <span className={`review-mark is-${mark}`}>{markLabels[mark]}</span>}
          {pending && !needsChoice && candidates.length > 0 && (
            <button type="button" className="link" aria-expanded={shown} aria-controls={choiceId} onClick={() => setOpenChoices((cur) => flip(cur, e.id))}>
              {s.reviewChangeChoice}
            </button>
          )}
          {pending && needsChoice && card === null && <span className="badge warning">{s.reviewNeedsChoice}</span>}
          {missing.length > 0 && <span className="error">{s.reviewNamesRequired}</span>}
          {sourcesToggle(e.id, e.sources.length)}
          {pending && (
            <span className="review-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => void rejectItems(doc.id, { entities: [e.id], relations: [] })}>
                {s.reviewReject}
              </button>
              {opts.confirm !== undefined && (
                <button type="button" disabled={busy || opts.confirmDisabled || missing.length > 0} onClick={opts.confirm}>
                  {busy ? s.reviewWorking : (opts.confirmLabel ?? s.reviewConfirm)}
                </button>
              )}
            </span>
          )}
        </div>
        {/* 合併選擇（#243）：兩張單選卡，同一組 radio；候選有多個時「合併到既有實體」卡內逐一列出。
            列內展開（kExpand）；選擇合併時卡片頂端由左畫出連線（kGrow，換對象時重畫） */}
        {shown && (
          <div className="review-expand">
            <div className="review-choice" id={choiceId} role="radiogroup" aria-label={pendingName(e, language)}>
              <div className={card === "merge" ? "review-choice__card is-selected" : "review-choice__card"}>
                {card === "merge" && <span key={choice.mergeInto} className="review-choice__link" aria-hidden="true" />}
                <span className="review-choice__title">
                  {s.reviewMergeInto}
                  {(mark === "suggested" || mark === "auto") && <span className="review-mark">{markLabels[mark]}</span>}
                </span>
                {candidates.map((id) => {
                  const target = graph.entities.find((x) => x.id === id);
                  return (
                    <label key={id} className="review-choice__option">
                      <input type="radio" name={choiceId} checked={choice.mergeInto === id} disabled={busy} onChange={() => pick(id)} />
                      {target ? entityOptionLabel(graph, target, language) : id}
                    </label>
                  );
                })}
              </div>
              <label className={card === "new" ? "review-choice__card is-selected" : "review-choice__card"}>
                <span className="review-choice__option">
                  <input type="radio" name={choiceId} checked={choice.mergeInto === null} disabled={busy} onChange={() => pick(null)} />
                  <span className="review-choice__title">{s.reviewCreateNew}</span>
                </span>
              </label>
            </div>
          </div>
        )}
        {shown && card === "merge" && <p className="muted review-hint">{s.reviewMergeHint}</p>}
        {openSources.has(e.id) && sourceList(doc, e.id, e.sources, [e.id])}
      </div>
    );
  };
  // 一段關係一行：「起點 —關係→ 終點」、圖譜已有、出處的開關與退回；waiting：另一端還待審，確認這組時不會一起核准
  const relationRow = (doc: ReviewDocument, r: ReviewRelation, opts: { existing?: boolean; waiting?: boolean }) => (
    <>
      <div className="review-row">
        <span>
          {nameOf(doc, r.from)} —{relationTypeLabel(r.type, language)}→ {nameOf(doc, r.to)}
        </span>
        {opts.existing && <span className="review-mark is-existing">{s.reviewExisting}</span>}
        {r.rejectedWithEntity && <span className="badge">{s.reviewRejectedWithEntity}</span>}
        {opts.waiting && <span className="muted">{s.reviewRelationBlocked}</span>}
        {sourcesToggle(r.id, r.sources.length)}
        {r.status === "pending" && (
          <span className="review-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => void rejectItems(doc.id, { entities: [], relations: [r.id] })}>
              {s.reviewReject}
            </button>
          </span>
        )}
      </div>
      {openSources.has(r.id) && sourceList(doc, r.id, r.sources, [r.from, r.to])}
    </>
  );

  return (
    <div className="review-page">
      <div className="review-toolbar">
        {/* 第二層：底線式分頁（#243），數量直接接在名稱後（0 時不顯示） */}
        <div className="review-tabs" role="tablist" aria-label={s.reviewStatusTabs} onKeyDown={tabKey}>
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`${ids}-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`${ids}-panel`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => selectTab(t)}
            >
              {tabLabels[t]}
              {counts[t] > 0 && <span className="review-tabs__count"> {counts[t]}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" aria-label={s.reviewRefresh} title={s.reviewRefresh} disabled={busy} onClick={refresh}>
          ↻
        </button>
      </div>
      {/* 短提示：浮動在視窗上方置中；live region 一直存在，內容出現時螢幕閱讀器才讀得到 */}
      <div className="toast-region" role="status">
        {toast !== null && (
          <div
            key={toast.id}
            className="toast"
            onMouseEnter={() => toastTimer.current?.hold("hover")}
            onMouseLeave={() => toastTimer.current?.release("hover")}
            onFocus={() => toastTimer.current?.hold("focus")}
            onBlur={(ev) => {
              if (!ev.currentTarget.contains(ev.relatedTarget)) toastTimer.current?.release("focus");
            }}
          >
            {toast.result === undefined ? (
              <span>{toast.text}</span>
            ) : (
              <span className="review-result" style={{ "--result-delay": `${toast.result}ms` } as CSSProperties}>
                {toast.text}
              </span>
            )}
            {toast.undo !== undefined && (
              <button type="button" className="link" disabled={busy} onClick={() => undo(toast.undo!)}>
                {s.reviewUndo}
              </button>
            )}
            {toast.graph && (
              <button type="button" className="link" onClick={onGotoGraph}>
                {s.reviewGotoGraph}
              </button>
            )}
            <button type="button" className="icon-button" aria-label={s.dialogClose} title={s.dialogClose} onClick={() => setToast(null)}>
              ✕
            </button>
          </div>
        )}
      </div>
      {extracting && <Notice kind="info" title={s.reviewExtracting} action={{ label: s.reviewRefresh, onClick: refresh, disabled: busy }} />}
      <div className="review-panel" role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`}>
        {tab === "reports" && (
          <ReportList
            db={db}
            identity={identity}
            language={language}
            reports={reports}
            graph={graph}
            onOpenSource={onOpenSource}
            onViewInGraph={onViewInGraph}
            onResolved={refresh}
          />
        )}
        {tab !== "reports" && visibleDocs.length === 0 && (
          // 待審清空（#245）：到圖譜查看、再上傳一份；已退回與已處理的分頁只有標題
          <EmptyState
            icon="review"
            title={tab === "pending" ? s.reviewEmpty : tab === "rejected" ? s.reviewRejectedEmpty : s.reviewDecidedEmpty}
            reason={tab === "pending" ? s.reviewEmptyReason : undefined}
            actions={
              tab === "pending"
                ? [
                    { label: s.reviewGotoGraph, onClick: onGotoGraph },
                    ...(onGotoUpload === undefined ? [] : [{ label: s.reviewUploadAnother, onClick: onGotoUpload }]),
                  ]
                : []
            }
          />
        )}

        {visibleDocs.map((doc) => {
          const docConflicts = conflictsOf(doc.id);
          const approvedCount = [...doc.entities, ...doc.relations].filter((x) => x.status === "approved").length;
          // 待審分頁：分組、摘要與進度（#189）；只有說法不同、沒有待審實體與關係的文件不顯示
          const g = tab === "pending" ? reviewGroups(doc, suggestions, allChoices, graph, client.languages) : null;
          const preparedCount = g === null ? 0 : g.prepared.entities.length + g.prepared.relations.length;
          const hasItems = g !== null && g.groups.length + preparedCount > 0;
          const decideLeft = g?.groups.filter((x) => x.kind === "decide").length ?? 0;
          const preparedMerges = g?.prepared.entities.some((e) => typeof allChoices[e.id].mergeInto === "string") ?? false;
          const rejectedEntities = tab === "rejected" ? doc.entities.filter((e) => e.status === "rejected") : [];
          const rejectedRelations = tab === "rejected" ? doc.relations.filter((r) => r.status === "rejected") : [];
          // 收合（#243）：只在待審分頁，沒有需要確認的組與待處理的說法不同時
          const collapsible = tab === "pending" && docCollapsible(g?.summary.toConfirm ?? 0, docConflicts.length);
          if (tab === "pending" && !firstOpen.current.has(doc.id)) firstOpen.current.set(doc.id, !collapsible);
          const open = !collapsible || (openDocs[doc.id] ?? firstOpen.current.get(doc.id) ?? false);
          const bodyId = `${ids}-doc-${doc.id}`;
          return (
            <section key={doc.id} className="card review-doc">
              {notice?.docId === doc.id && notice.error !== undefined && (
                <Notice kind="error" title={s.noticeReviewTitle} action={{ label: s.reviewRefresh, onClick: refresh, disabled: busy }}>
                  {notice.error}
                </Notice>
              )}
              {notice?.docId === doc.id && (notice.skipped ?? 0) > 0 && (
                <Notice kind="warning" title={s.reviewSkippedNames}>
                  {notice.skipped}
                </Notice>
              )}
              {/* 頁首（#243）：左側標題、可見等級與摘要；右側「還有 N 組需要你確認」與「核准這份文件的全部」 */}
              <header className="review-doc__head">
                <div className="review-doc__title">
                  <h2 lang={doc.language}>
                    {doc.title} <AccessBadges visibility={doc.visibility} project={doc.project} language={language} />
                  </h2>
                  {g !== null && hasItems && (
                    <p className="review-summary">
                      {fill(s.reviewSummary, {
                        entities: g.summary.newEntities,
                        relations: g.summary.newRelations,
                        merged: g.summary.mergedEntities,
                        existing: g.summary.existingRelations,
                      }, language)}
                    </p>
                  )}
                  {approvedCount > 0 && (
                    <p className="muted">
                      {s.reviewApprovedCount}
                      {s.colon}
                      {approvedCount}
                    </p>
                  )}
                </div>
                {(hasItems || collapsible) && (
                  <div className="review-doc__side">
                    {g !== null && hasItems && (
                      <>
                        {g.summary.toConfirm > 0 ? (
                          <strong className="review-to-confirm">{fill(s.reviewProgress, { count: g.summary.toConfirm }, language)}</strong>
                        ) : (
                          <span className="muted">{s.reviewProgressDone}</span>
                        )}
                        <button type="button" disabled={busy} onClick={() => approveAll(doc.id, batchPlan(doc, suggestions, allChoices, client.languages, graph))}>
                          {busy ? s.reviewWorking : s.reviewApproveDocument}
                        </button>
                      </>
                    )}
                    {collapsible && (
                      <button
                        type="button"
                        className="link"
                        aria-expanded={open}
                        aria-controls={bodyId}
                        onClick={() => setOpenDocs((cur) => ({ ...cur, [doc.id]: !open }))}
                      >
                        {open ? s.reviewCollapse : s.reviewExpand}
                      </button>
                    )}
                  </div>
                )}
              </header>
              {decideLeft > 0 && <p className="muted review-decide-left">{fill(s.reviewDecideLeft, { count: decideLeft }, language)}</p>}

              <div className="review-doc__body" id={bodyId} hidden={!open}>
                {g !== null && hasItems && (
                  <>
                    <h3 className="review-group-title">{s.reviewEntities}</h3>
                    {/* 需要你確認的組：一組一個實體，關係掛在它底下；「確認」一併核准已經可以核准的關係 */}
                    {g.groups.length > 0 && (
                      <ul className="review-list">
                        {g.groups.map((group, gi) => {
                          const plan = groupPlan(doc, group, g.prepared.entities, suggestions, allChoices, client.languages);
                          const waiting = waitingRelations(doc, group, g.prepared.entities, suggestions, allChoices, client.languages);
                          const relationCount = plan === null ? 0 : plan.relations.length + plan.existingRelations.length;
                          return (
                            <li key={group.entity.id} {...itemProps(group.entity.id, gi)}>
                              <div className="review-item__body">
                                {entityRow(doc, group.entity, {
                                  confirm: () => {
                                    if (plan) void approveItems(doc.id, plan, 0, [group.entity.id]);
                                  },
                                  confirmLabel: relationCount > 0 ? fill(s.reviewConfirmWithRelations, { count: relationCount }, language) : s.reviewConfirm,
                                  confirmDisabled: plan === null,
                                })}
                                {group.relations.length > 0 && (
                                  <ul className="review-rows">
                                    {group.relations.map((x, i) => (
                                      <li key={x.relation.id} {...itemProps(x.relation.id, i)}>
                                        <div className="review-item__body">{relationRow(doc, x.relation, { existing: x.existing, waiting: waiting.has(x.relation.id) })}</div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {/* 系統已準備：系統建議、自動合併與圖譜已有，收合成一行；合併的可見範圍提示在收合時也看得到。
                        實體可以逐筆核准（batchPlan 只含這一筆） */}
                    {preparedCount > 0 && (
                      <details className="review-prepared">
                        {/* 收合時看不到列：全部往右離開時，這一行一起離開（#243 PR 4） */}
                        <summary
                          className={
                            [...g.prepared.entities.map((e) => e.id), ...g.prepared.relations.map((x) => x.relation.id)].every((id) => leaving.get(id) === "away")
                              ? "is-away"
                              : undefined
                          }
                        >
                          {fill(s.reviewPrepared, { count: preparedCount }, language)}
                          {preparedMerges && <span className="muted"> {s.reviewPreparedMergeHint}</span>}
                        </summary>
                        <ul className="review-rows">
                          {g.prepared.entities.map((e, i) => {
                            const plan = batchPlan(doc, suggestions, allChoices, client.languages, graph, new Set([e.id]));
                            return (
                              <li key={e.id} {...itemProps(e.id, i)}>
                                <div className="review-item__body">
                                  {entityRow(doc, e, {
                                    confirm: () => approveBatch(doc.id, plan, [e.id]),
                                    confirmLabel: s.reviewApprove,
                                    confirmDisabled: plan.entities.length === 0,
                                  })}
                                </div>
                              </li>
                            );
                          })}
                          {g.prepared.relations.map((x, i) => (
                            <li key={x.relation.id} {...itemProps(x.relation.id, g.prepared.entities.length + i)}>
                              <div className="review-item__body">{relationRow(doc, x.relation, { existing: x.existing })}</div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}

                {rejectedEntities.length > 0 && <h3 className="review-group-title">{s.reviewEntities}</h3>}
                {rejectedEntities.length > 0 && (
                  <ul className="review-rows">
                    {rejectedEntities.map((e, i) => (
                      <li key={e.id} {...itemProps(e.id, i)}>
                        <div className="review-item__body">{entityRow(doc, e, {})}</div>
                      </li>
                    ))}
                  </ul>
                )}
                {rejectedRelations.length > 0 && <h3 className="review-group-title">{s.reviewRelations}</h3>}
                {rejectedRelations.length > 0 && (
                  <ul className="review-rows">
                    {rejectedRelations.map((r, i) => (
                      <li key={r.id} {...itemProps(r.id, i)}>
                        <div className="review-item__body">{relationRow(doc, r, {})}</div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* 說法不同（#51）：新舊段落左右並列，附模型的差異說明（純文字）；待審分頁有三個處理按鈕，已處理分頁顯示決定 */}
                {docConflicts.length > 0 && <h3 className="review-group-title">{s.conflictSection}</h3>}
                <ul className="review-list">
                  {docConflicts.map((c, i) => (
                    <li key={c.id} {...itemProps(c.id, i)}>
                      <div className="review-item__body">
                        <p className="conflict-summary" lang={c.newPassage.language}>
                          {c.summary}
                        </p>
                        {c.decision !== null && <span className="badge">{s.conflictDecisions[c.decision]}</span>}
                        {/* 並存：兩卡之間畫出等號、兩邊標上關聯；取代：舊說法變淡、劃掉（#243 PR 4） */}
                        <div className="conflict-pair" data-settle={settling.get(c.id)}>
                          {conflictSide(s.conflictNew, c.newPassage, { linked: settling.get(c.id) === "coexist" ? { index: 0, other: c.oldPassage } : undefined })}
                          {settling.get(c.id) === "coexist" && (
                            <span className="conflict-equals" aria-hidden="true">
                              <span />
                              <span />
                            </span>
                          )}
                          {conflictSide(s.conflictOld, c.oldPassage, {
                            linked: settling.get(c.id) === "coexist" ? { index: 1, other: c.newPassage } : undefined,
                            superseded: settling.get(c.id) === "supersede",
                          })}
                        </div>
                        {c.decision === null && (
                          <div className="conflict-actions">
                            {CONFLICT_DECISIONS.map((d) => (
                              <button key={d} type="button" className={d === "not_conflict" ? "secondary" : undefined} disabled={busy} onClick={() => decide(doc.id, c.id, d)}>
                                {busy ? s.reviewWorking : s.conflictDecisions[d]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
