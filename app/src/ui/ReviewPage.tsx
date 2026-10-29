// 待審頁（#44，docs/extraction.md「畫面」）：只有 canReview 的身分看得到。依文件分組列出待審的實體與關係，
// 可以修改名稱、選擇合併對象、勾選後批次核准、核准整份文件、退回；另有「已退回」分頁。
// 卡片平常只顯示名稱，按「編輯名稱」才可以修改；出處預設 2 行、標出實體名稱；核准或退回後顯示短提示（#48）。
// 讀取與寫入都經 store.ts（RLS 決定看得到、能核准什麼）；模型輸出一律以文字節點顯示。
import { Fragment, useEffect, useRef, useState } from "react";
import { clientConfig } from "../client/load";
import type { LocalizedText } from "../client/types";
import type { Database } from "../db/database";
import { suggestMerge, type MergeSuggestion } from "../extraction/merge";
import { approve, readReview, reject, ReviewError, type EntityApproval, type ReviewDocument, type ReviewEntity } from "../extraction/store";
import { readGraph, type Graph } from "../graph/read";
import { AccessBadges } from "./AccessBadges";
import { entityOptionLabel, entityTypeLabel, relationTypeLabel } from "./graph-labels";
import { Notice } from "./Notice";
import { createRequestGate } from "./requests";
import { batchPlan, canBatch, entityApproval, highlightSegments, initialChoice, inputSize, namesInvalid, relationReady, type EntityChoice } from "./review-helpers";
import { strings } from "./strings";

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
}

// 短提示自動消失的時間
const TOAST_MS = 6000;

const { client, knowledgeModel } = clientConfig;

// 待審實體沒有主要名稱（name），依介面語言取 names
const pendingName = (e: ReviewEntity, language: string) => e.names[language] || Object.values(e.names)[0] || e.id;

export function ReviewPage({ db, identity, language, extracting, onOpenSource, onChanged, onGotoGraph }: Props) {
  const s = strings(language);
  const [tab, setTab] = useState<"pending" | "rejected">("pending");
  const [docs, setDocs] = useState<ReviewDocument[] | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [choices, setChoices] = useState<Record<string, EntityChoice>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // 核准或退回的錯誤、批次核准時因名稱不完整而略過的筆數；顯示在該文件的卡片上方（#48）
  const [notice, setNotice] = useState<{ docId: string; error?: string; skipped?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // 正在編輯名稱的實體、展開的出處（項目 id 與段落 id）、核准或退回後的短提示
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  // 連點時 state 還沒更新，以 ref 確保同時只有一個核准或退回在進行（比照 #42）
  const working = useRef(false);
  const reads = useRef(createRequestGate());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const ticket = reads.current.begin();
    void Promise.all([readReview(db, identity), readGraph(db, identity)]).then(([d, g]) => {
      if (!ticket.isCurrent()) return;
      setDocs(d);
      setGraph(g);
      setSelected(new Set());
    });
    return () => reads.current.cancel();
  }, [db, identity, version]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => {
      clearTimeout(timer);
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
  const toggle = (id: string) => setSelected((cur) => flip(cur, id));
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  const languageNames = new Intl.DisplayNames([language], { type: "language" });

  // done：成功後的短提示
  async function run(docId: string, action: () => Promise<void>, done: string, skipped = 0) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice(skipped > 0 ? { docId, skipped } : null);
    setToast(null);
    try {
      await action();
      setToast(done);
    } catch (e) {
      setNotice({ docId, skipped, error: e instanceof ReviewError ? s.reviewErrors[e.reason] : s.unknownError });
    } finally {
      working.current = false;
      setBusy(false);
      refresh();
    }
  }
  // skippedCount：批次核准時因名稱不完整而略過的筆數（逐筆核准時為 0，清除先前的提示）
  const approveItems = (docId: string, items: { entities: EntityApproval[]; relations: string[] }, skippedCount = 0) =>
    run(
      docId,
      () => approve(db, identity, items, { defaultLanguage: client.defaultLanguage }),
      s.reviewToastApproved.replace("{count}", String(items.entities.length + items.relations.length)),
      skippedCount,
    );
  const approveBatch = (docId: string, plan: ReturnType<typeof batchPlan>) =>
    void approveItems(docId, { entities: plan.entities, relations: plan.relations }, plan.skipped);
  const rejectItems = (docId: string, items: { entities: string[]; relations: string[] }) =>
    run(docId, () => reject(db, identity, items), s.reviewToastRejected.replace("{count}", String(items.entities.length + items.relations.length)));

  const nameOf = (doc: ReviewDocument, id: string) => {
    const e = doc.entities.find((x) => x.id === id);
    return e ? (choiceOf(e).names?.[language] ?? pendingName(e, language)) : id;
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
  const visibleDocs = docs.filter((d) =>
    tab === "pending" ? [...d.entities, ...d.relations].some((x) => x.status === "pending") : [...d.entities, ...d.relations].some((x) => x.status === "rejected"),
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
        </div>
        <button type="button" className="icon-button" aria-label={s.reviewRefresh} title={s.reviewRefresh} disabled={busy} onClick={refresh}>
          ↻
        </button>
      </div>
      {/* 短提示：live region 一直存在，內容出現時螢幕閱讀器才讀得到 */}
      <div className="toast-region" role="status">
        {toast !== null && (
          <div className="toast">
            <span>{toast}</span>
            <button type="button" className="link" onClick={onGotoGraph}>
              {s.reviewGotoGraph}
            </button>
            <button type="button" className="icon-button" aria-label={s.dialogClose} title={s.dialogClose} onClick={() => setToast(null)}>
              ✕
            </button>
          </div>
        )}
      </div>
      {extracting && <Notice kind="info" title={s.reviewExtracting} action={{ label: s.reviewRefresh, onClick: refresh, disabled: busy }} />}
      {visibleDocs.length === 0 && <p className="card muted">{tab === "pending" ? s.reviewEmpty : s.reviewRejectedEmpty}</p>}

      {visibleDocs.map((doc) => {
        const pendingEntities = doc.entities.filter((e) => (tab === "pending" ? e.status === "pending" : e.status === "rejected"));
        const pendingRelations = doc.relations.filter((r) => (tab === "pending" ? r.status === "pending" : r.status === "rejected"));
        const approvedCount = [...doc.entities, ...doc.relations].filter((x) => x.status === "approved").length;
        const batchable = [...pendingEntities.filter((e) => canBatch(suggestions[e.id])).map((e) => e.id), ...pendingRelations.map((r) => r.id)];
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
            {tab === "pending" && (
              <div className="dialog-actions">
                <button type="button" className="secondary" disabled={busy} onClick={() => setSelected(new Set(batchable))}>
                  {s.reviewSelectAll}
                </button>
                <button type="button" disabled={busy || selected.size === 0} onClick={() => approveBatch(doc.id, batchPlan(doc, suggestions, allChoices, client.languages, selected))}>
                  {busy ? s.reviewWorking : s.reviewApproveSelected}
                </button>
                <button type="button" disabled={busy} onClick={() => approveBatch(doc.id, batchPlan(doc, suggestions, allChoices, client.languages))}>
                  {busy ? s.reviewWorking : s.reviewApproveDocument}
                </button>
              </div>
            )}

            <h3>{s.reviewEntities}</h3>
            <ul className="review-list">
              {pendingEntities.map((e) => {
                const suggestion = suggestions[e.id];
                const choice = choiceOf(e);
                const needsChoice = suggestion.mode === "choose";
                const candidates = suggestion.mode === "choose" ? suggestion.candidates : suggestion.mode === "auto" ? [suggestion.target] : [];
                const names: LocalizedText = choice.names ?? e.names;
                const invalidNames = namesInvalid(choice, client.languages);
                // 只有建立新實體的項目可以編輯名稱（#44 決定 4）；名稱不完整時一直顯示輸入框
                const editable = tab === "pending" && choice.mergeInto === null;
                const isEditing = editable && (editing.has(e.id) || invalidNames);
                return (
                  <li key={e.id}>
                    {tab === "pending" && (
                      <input type="checkbox" aria-label={pendingName(e, language)} disabled={busy || needsChoice} checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                    )}
                    <span className="badge">{entityTypeLabel(e.type, language)}</span>{" "}
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
                    {needsChoice && tab === "pending" && <p className="badge warning">{s.reviewNeedsChoice}</p>}
                    {tab === "pending" && candidates.length > 0 && (
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
                    {tab === "pending" && typeof choice.mergeInto === "string" && <p className="muted">{s.reviewMergeHint}</p>}
                    {tab === "pending" && invalidNames && <p className="error">{s.reviewNamesRequired}</p>}
                    {sourceList(doc, e.id, e.sources, [e.id])}
                    {tab === "pending" && (
                      <div className="dialog-actions">
                        <button
                          type="button"
                          disabled={busy || choice.mergeInto === undefined || invalidNames}
                          onClick={() => {
                            const approval = entityApproval(e.id, choice, client.languages);
                            if (approval) void approveItems(doc.id, { entities: [approval], relations: [] });
                          }}
                        >
                          {busy ? s.reviewWorking : s.reviewApprove}
                        </button>
                        <button type="button" className="secondary" disabled={busy} onClick={() => void rejectItems(doc.id, { entities: [e.id], relations: [] })}>
                          {s.reviewReject}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {pendingRelations.length > 0 && <h3>{s.reviewRelations}</h3>}
            <ul className="review-list">
              {pendingRelations.map((r) => (
                <li key={r.id}>
                  {tab === "pending" && (
                    <input type="checkbox" aria-label={r.id} disabled={busy} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  )}
                  {nameOf(doc, r.from)} —{relationTypeLabel(r.type, language)}→ {nameOf(doc, r.to)}
                  {r.rejectedWithEntity && <span className="badge">{s.reviewRejectedWithEntity}</span>}
                  {sourceList(doc, r.id, r.sources, [r.from, r.to])}
                  {tab === "pending" && (
                    <div className="dialog-actions">
                      <button
                        type="button"
                        disabled={busy || !relationReady(doc, r.id)}
                        title={relationReady(doc, r.id) ? undefined : s.reviewRelationBlocked}
                        onClick={() => void approveItems(doc.id, { entities: [], relations: [r.id] })}
                      >
                        {busy ? s.reviewWorking : s.reviewApprove}
                      </button>
                      <button type="button" className="secondary" disabled={busy} onClick={() => void rejectItems(doc.id, { entities: [], relations: [r.id] })}>
                        {s.reviewReject}
                      </button>
                      {!relationReady(doc, r.id) && <span className="muted">{s.reviewRelationBlocked}</span>}
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
