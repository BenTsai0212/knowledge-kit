// 待審頁（#44，docs/extraction.md「畫面」）：只有 canReview 的身分看得到。依文件列出待審的實體與關係，
// 每份文件開頭是摘要與進度，需要確認的組在最上面，系統已準備的收合成一行（#189，分組在 review-helpers.ts 的 reviewGroups()）；
// 可以修改名稱、選擇合併對象、確認一組、核准整份文件、退回；另有「已退回」分頁。
// 每筆一行，按「編輯名稱」才可以修改；出處點開才顯示，預設 2 行、標出實體名稱；核准或退回後顯示短提示（#48），附「撤銷」（ADR 0007 決定 4）。
// 每份文件另有「說法不同」區塊（#51）：新舊段落並列、三選一處理；已處理的在「已處理的說法不同」分頁。
// 「回報」分頁是問答的回答錯誤回報（ADR 0007 決定 7，ReportList.tsx）。
// 讀取與寫入都經 store.ts、conflicts/store.ts（RLS 決定看得到、能核准什麼）；模型輸出一律以文字節點顯示。
import { Fragment, useEffect, useRef, useState } from "react";
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
  groupPlan,
  highlightSegments,
  initialChoice,
  inputSize,
  namesInvalid,
  reviewDocuments,
  reviewGroups,
  toastText,
  waitingRelations,
  type EntityChoice,
} from "./review-helpers";
import { fill, strings } from "../client/i18n";
import { createToastTimer, type ToastTimer } from "./toast-timer";

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

// 短提示自動消失的時間；滑鼠停在提示上或焦點在提示內時暫停（toast-timer.ts，#48 審查）
const TOAST_MS = 10_000;

const { client, knowledgeModel } = clientConfig;

// 說法不同的三種處理方式（#51 決定 4），依按鈕的順序
const CONFLICT_DECISIONS: readonly ConflictDecision[] = ["coexist", "supersede", "not_conflict"];

// 待審實體沒有主要名稱（name），依介面語言取 names
const pendingName = (e: ReviewEntity, language: string) => e.names[language] || Object.values(e.names)[0] || e.id;

export function ReviewPage({ db, identity, language, extracting, onOpenSource, onChanged, onGotoGraph, onGotoUpload, onViewInGraph }: Props) {
  const s = strings(language);
  // decided：已處理的說法不同（#51）；reports：回答錯誤回報（ADR 0007）
  const [tab, setTab] = useState<"pending" | "rejected" | "decided" | "reports">("pending");
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
  // graph：附「到圖譜查看」（只有核准；退回的項目不會出現在圖譜）。undo：這次寫入的決定，附「撤銷」（ADR 0007 決定 4）。
  // id 每次遞增，當作 key：文字與上一次相同時也重新掛載，重新播放進場動畫（#48 審查第 2 次）
  const [toast, setToast] = useState<{ id: number; text: string; graph: boolean; undo?: { docId: string; decisions: string[] } } | null>(null);
  const toastId = useRef(0);
  const toastTimer = useRef<ToastTimer | null>(null);
  // 連點時 state 還沒更新，以 ref 確保同時只有一個核准或退回在進行（比照 #42）
  const working = useRef(false);
  const reads = useRef(createRequestGate());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const ticket = reads.current.begin();
    void Promise.all([readReview(db, identity), readGraph(db, identity), readConflicts(db, identity), readReports(db, identity)]).then(([d, g, c, r]) => {
      if (!ticket.isCurrent()) return;
      setDocs(reviewDocuments(d, c));
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
  const unresolved = reports.filter((r) => r.resolution === null).length;
  const languageNames = new Intl.DisplayNames([language], { type: "language" });

  // done：成功後的短提示；undoable 時 action 回傳的決定 id 交給「撤銷」
  async function run(docId: string, action: () => Promise<string[] | void>, done: { text: string; graph: boolean; undoable?: boolean }, skipped = 0) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice(skipped > 0 ? { docId, skipped } : null);
    setToast(null);
    try {
      const decisions = await action();
      const undo = done.undoable && Array.isArray(decisions) && decisions.length > 0 ? { docId, decisions } : undefined;
      setToast({ text: done.text, graph: done.graph, undo, id: ++toastId.current });
    } catch (e) {
      setNotice({ docId, skipped, error: e instanceof ReviewError ? s.reviewErrors[e.reason] : s.unknownError });
    } finally {
      working.current = false;
      setBusy(false);
      refresh();
    }
  }
  // skippedCount：批次核准時因名稱不完整而略過的筆數（逐筆核准時為 0，清除先前的提示）
  const approveItems = (docId: string, items: { entities: EntityApproval[]; relations: string[]; existingRelations?: string[] }, skippedCount = 0) =>
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
    );
  const approveBatch = (docId: string, plan: ReturnType<typeof batchPlan>) =>
    void approveItems(docId, { entities: plan.entities, relations: plan.relations, existingRelations: plan.existingRelations }, plan.skipped);
  const rejectItems = (docId: string, items: { entities: string[]; relations: string[] }) =>
    run(docId, () => reject(db, identity, items), {
      text: toastText({ one: s.reviewToastRejectedOne, many: s.reviewToastRejected }, itemLabels(docId, items.entities, items.relations)),
      graph: false,
      undoable: true,
    });
  // 撤銷：撤回剛寫入的每一筆決定（退回時含一併退回的關係），項目回到待審
  const undo = (target: { docId: string; decisions: string[] }) =>
    void run(target.docId, () => retract(db, identity, target.decisions), { text: s.reviewToastUndone, graph: false });

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
  const decide = (docId: string, conflictId: string, decision: ConflictDecision) =>
    void run(docId, () => decideConflict(db, identity, conflictId, decision), {
      text: toastText({ one: s.conflictToast, many: s.conflictToast }, [s.conflictDecisions[decision]]),
      graph: false,
    });
  // 新舊說法的一側：文件標題、等級與專案的標籤、日期、內容（文件的語言）與「打開原文」
  const conflictSide = (label: string, p: ConflictPassage) => (
    <div className="conflict-side">
      <h4>{label}</h4>
      <p>
        <span lang={p.language}>{p.documentTitle}</span> <AccessBadges visibility={p.visibility} project={p.project} language={language} />{" "}
        <time className="muted" dateTime={p.date ?? undefined}>
          {p.date ?? s.undated}
        </time>
      </p>
      <p lang={p.language}>{p.content}</p>
      <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
        {s.openSource}
      </button>
    </div>
  );

  // 出處的開關：每筆一行，出處點開才顯示（#189）
  const sourcesToggle = (itemId: string, count: number) =>
    count > 0 && (
      <button type="button" className="link" aria-expanded={openSources.has(itemId)} onClick={() => setOpenSources((cur) => flip(cur, itemId))}>
        {fill(s.reviewSources, { count }, language)}
      </button>
    );
  // 一筆實體一行（#189）：類型、標籤、名稱、合併選擇、出處的開關與動作。
  // badge：「新增」「系統建議」；mergeHint：選擇合併時在下一行提示可見範圍；confirm：「確認」一組（沒有時只有退回），confirmLabel 寫明一起核准的關係數
  const entityRow = (
    doc: ReviewDocument,
    e: ReviewEntity,
    opts: { badge?: string; mergeHint?: boolean; confirm?: () => void; confirmLabel?: string; confirmDisabled?: boolean },
  ) => {
    const pending = e.status === "pending";
    const suggestion = suggestions[e.id];
    const choice = choiceOf(e);
    const candidates = suggestion.mode === "choose" ? suggestion.candidates : suggestion.mode === "auto" ? [suggestion.target] : [];
    const needsChoice = !canBatch(suggestion);
    const names: LocalizedText = choice.names ?? e.names;
    const invalidNames = pending && namesInvalid(choice, client.languages);
    // 只有建立新實體的項目可以編輯名稱（#44 決定 4）；名稱不完整時一直顯示輸入框
    const editable = pending && choice.mergeInto === null;
    const isEditing = editable && (editing.has(e.id) || invalidNames);
    return (
      <>
        <div className="review-row">
          <span className="badge">{entityTypeLabel(e.type, language)}</span>
          {opts.badge !== undefined && <span className="badge primary">{opts.badge}</span>}
          {isEditing ? (
            <span className="review-names editing">
              {client.languages.map((l) => (
                <label key={l} className="inline">
                  {languageNames.of(l) ?? l}
                  <input
                    type="text"
                    lang={l}
                    value={names[l] ?? ""}
                    size={inputSize(names[l] ?? "")}
                    disabled={busy}
                    onChange={(ev) => setChoice(e.id, { ...choice, names: { ...names, [l]: ev.target.value } })}
                  />
                </label>
              ))}
              <button type="button" className="secondary" disabled={busy || invalidNames} onClick={() => setEditing((cur) => flip(cur, e.id))}>
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
          {pending && candidates.length > 0 && (
            <label className="inline">
              {s.reviewMergeInto}
              <select
                value={choice.mergeInto === undefined ? "" : (choice.mergeInto ?? "new")}
                disabled={busy}
                onChange={(ev) => setChoice(e.id, { mergeInto: ev.target.value === "" ? undefined : ev.target.value === "new" ? null : ev.target.value })}
              >
                {needsChoice && <option value="">{s.reviewChoose}</option>}
                {candidates.map((id) => {
                  const target = graph.entities.find((x) => x.id === id);
                  return (
                    <option key={id} value={id}>
                      {target ? entityOptionLabel(graph, target, language) : id}
                    </option>
                  );
                })}
                <option value="new">{s.reviewCreateNew}</option>
              </select>
            </label>
          )}
          {pending && needsChoice && choice.mergeInto === undefined && <span className="badge warning">{s.reviewNeedsChoice}</span>}
          {invalidNames && <span className="error">{s.reviewNamesRequired}</span>}
          {sourcesToggle(e.id, e.sources.length)}
          {pending && (
            <span className="review-actions">
              {opts.confirm !== undefined && (
                <button type="button" disabled={busy || opts.confirmDisabled} onClick={opts.confirm}>
                  {busy ? s.reviewWorking : (opts.confirmLabel ?? s.reviewConfirm)}
                </button>
              )}
              <button type="button" className="secondary" disabled={busy} onClick={() => void rejectItems(doc.id, { entities: [e.id], relations: [] })}>
                {s.reviewReject}
              </button>
            </span>
          )}
        </div>
        {opts.mergeHint && pending && typeof choice.mergeInto === "string" && <p className="muted review-hint">{s.reviewMergeHint}</p>}
        {openSources.has(e.id) && sourceList(doc, e.id, e.sources, [e.id])}
      </>
    );
  };
  // 一段關係一行：「起點 —關係→ 終點」、圖譜已有、出處的開關與退回；waiting：另一端還待審，確認這組時不會一起核准
  const relationRow = (doc: ReviewDocument, r: ReviewRelation, opts: { existing?: boolean; waiting?: boolean }) => (
    <>
      <div className="review-row">
        <span>
          {nameOf(doc, r.from)} —{relationTypeLabel(r.type, language)}→ {nameOf(doc, r.to)}
        </span>
        {opts.existing && <span className="badge">{s.reviewExisting}</span>}
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
        {/* 第二層：小一號的分段切換（#48） */}
        <div className="segmented" role="group" aria-label={s.reviewStatusTabs}>
          <button type="button" aria-pressed={tab === "pending"} onClick={() => setTab("pending")}>
            {s.reviewPendingTab}
          </button>
          <button type="button" aria-pressed={tab === "rejected"} onClick={() => setTab("rejected")}>
            {s.reviewRejectedTab}
          </button>
          <button type="button" aria-pressed={tab === "decided"} onClick={() => setTab("decided")}>
            {s.reviewDecidedTab}
          </button>
          {/* 回報：後面接著未處理的筆數 */}
          <button type="button" aria-pressed={tab === "reports"} onClick={() => setTab("reports")}>
            {s.reviewReportsTab}
            {unresolved > 0 && <span className="tab-count">{unresolved}</span>}
          </button>
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
            <span>{toast.text}</span>
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
            <h2 lang={doc.language}>
              {doc.title} <AccessBadges visibility={doc.visibility} project={doc.project} language={language} />
            </h2>
            {approvedCount > 0 && (
              <p className="muted">
                {s.reviewApprovedCount}
                {s.colon}
                {approvedCount}
              </p>
            )}
            {g !== null && hasItems && (
              <>
                <p className="review-summary">
                  {fill(s.reviewSummary, {
                    entities: g.summary.newEntities,
                    relations: g.summary.newRelations,
                    merged: g.summary.mergedEntities,
                    existing: g.summary.existingRelations,
                  }, language)}
                </p>
                <div className="dialog-actions review-progress">
                  <strong>{g.summary.toConfirm > 0 ? fill(s.reviewProgress, { count: g.summary.toConfirm }, language) : s.reviewProgressDone}</strong>
                  <button type="button" disabled={busy} onClick={() => approveBatch(doc.id, batchPlan(doc, suggestions, allChoices, client.languages, graph))}>
                    {busy ? s.reviewWorking : s.reviewApproveDocument}
                  </button>
                  {decideLeft > 0 && <span className="muted">{fill(s.reviewDecideLeft, { count: decideLeft }, language)}</span>}
                </div>
                {/* 需要你確認的組：一組一個實體，關係掛在它底下；「確認」一併核准已經可以核准的關係 */}
                {g.groups.length > 0 && (
                  <ul className="review-list">
                    {g.groups.map((group) => {
                      const plan = groupPlan(doc, group, g.prepared.entities, suggestions, allChoices, client.languages);
                      const waiting = waitingRelations(doc, group, g.prepared.entities, suggestions, allChoices, client.languages);
                      const relationCount = plan === null ? 0 : plan.relations.length + plan.existingRelations.length;
                      return (
                        <li key={group.entity.id}>
                          {entityRow(doc, group.entity, {
                            badge: group.kind === "new" ? s.reviewNew : undefined,
                            mergeHint: true,
                            confirm: () => {
                              if (plan) void approveItems(doc.id, plan);
                            },
                            confirmLabel: relationCount > 0 ? fill(s.reviewConfirmWithRelations, { count: relationCount }, language) : s.reviewConfirm,
                            confirmDisabled: plan === null,
                          })}
                          {group.relations.length > 0 && (
                            <ul className="review-rows">
                              {group.relations.map((x) => (
                                <li key={x.relation.id}>{relationRow(doc, x.relation, { existing: x.existing, waiting: waiting.has(x.relation.id) })}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {/* 系統已準備：系統建議、自動合併與圖譜已有，收合成一行；合併的可見範圍提示在收合時也看得到 */}
                {preparedCount > 0 && (
                  <details className="review-prepared">
                    <summary>
                      {fill(s.reviewPrepared, { count: preparedCount }, language)}
                      {preparedMerges && <span className="muted"> {s.reviewPreparedMergeHint}</span>}
                    </summary>
                    <ul className="review-rows">
                      {g.prepared.entities.map((e) => (
                        <li key={e.id}>{entityRow(doc, e, { badge: s.reviewSuggested })}</li>
                      ))}
                      {g.prepared.relations.map((x) => (
                        <li key={x.relation.id}>{relationRow(doc, x.relation, { existing: x.existing })}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}

            {rejectedEntities.length > 0 && <h3>{s.reviewEntities}</h3>}
            {rejectedEntities.length > 0 && (
              <ul className="review-rows">
                {rejectedEntities.map((e) => (
                  <li key={e.id}>{entityRow(doc, e, {})}</li>
                ))}
              </ul>
            )}
            {rejectedRelations.length > 0 && <h3>{s.reviewRelations}</h3>}
            {rejectedRelations.length > 0 && (
              <ul className="review-rows">
                {rejectedRelations.map((r) => (
                  <li key={r.id}>{relationRow(doc, r, {})}</li>
                ))}
              </ul>
            )}

            {/* 說法不同（#51）：新舊段落左右並列，附模型的差異說明（純文字）；待審分頁有三個處理按鈕，已處理分頁顯示決定 */}
            {docConflicts.length > 0 && <h3>{s.conflictSection}</h3>}
            <ul className="review-list">
              {docConflicts.map((c) => (
                <li key={c.id}>
                  <p className="conflict-summary" lang={c.newPassage.language}>
                    {c.summary}
                  </p>
                  {c.decision !== null && <span className="badge">{s.conflictDecisions[c.decision]}</span>}
                  <div className="conflict-pair">
                    {conflictSide(s.conflictNew, c.newPassage)}
                    {conflictSide(s.conflictOld, c.oldPassage)}
                  </div>
                  {c.decision === null && (
                    <div className="dialog-actions">
                      {CONFLICT_DECISIONS.map((d) => (
                        <button key={d} type="button" className={d === "not_conflict" ? "secondary" : undefined} disabled={busy} onClick={() => decide(doc.id, c.id, d)}>
                          {busy ? s.reviewWorking : s.conflictDecisions[d]}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
