// 待審頁（#44，docs/extraction.md「畫面」）：只有 canReview 的身分看得到。依文件分組列出待審的實體與關係，
// 可以修改名稱、選擇合併對象、勾選後批次核准、核准整份文件、退回；另有「已退回」分頁。
// 讀取與寫入都經 store.ts（RLS 決定看得到、能核准什麼）；模型輸出一律以文字節點顯示。
import { useEffect, useRef, useState } from "react";
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
import { batchPlan, canBatch, entityApproval, initialChoice, namesInvalid, relationReady, type EntityChoice } from "./review-helpers";
import { strings } from "./strings";

interface Props {
  db: Database;
  identity: string;
  language: string;
  // 有萃取還在進行時顯示提示
  extracting: boolean;
  onOpenSource(passageId: string): void;
}

const { client, knowledgeModel } = clientConfig;

// 待審實體沒有主要名稱（name），依介面語言取 names
const pendingName = (e: ReviewEntity, language: string) => e.names[language] || Object.values(e.names)[0] || e.id;

export function ReviewPage({ db, identity, language, extracting, onOpenSource }: Props) {
  const s = strings(language);
  const [tab, setTab] = useState<"pending" | "rejected">("pending");
  const [docs, setDocs] = useState<ReviewDocument[] | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [choices, setChoices] = useState<Record<string, EntityChoice>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // 核准或退回的錯誤、批次核准時因名稱不完整而略過的筆數；顯示在該文件的卡片上方（#48）
  const [notice, setNotice] = useState<{ docId: string; error?: string; skipped?: number } | null>(null);
  const [busy, setBusy] = useState(false);
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

  if (docs === null || graph === null) return <p className="card muted">{s.loading}</p>;

  const suggestions: Record<string, MergeSuggestion> = Object.fromEntries(
    docs.flatMap((d) => d.entities).map((e) => [e.id, suggestMerge(e, graph.entities, knowledgeModel.entityTypes)]),
  );
  const choiceOf = (e: ReviewEntity) => choices[e.id] ?? initialChoice(suggestions[e.id]);
  const allChoices = Object.fromEntries(docs.flatMap((d) => d.entities).map((e) => [e.id, choiceOf(e)]));
  const setChoice = (id: string, choice: EntityChoice) => setChoices((c) => ({ ...c, [id]: choice }));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function run(docId: string, action: () => Promise<void>, skipped = 0) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice(skipped > 0 ? { docId, skipped } : null);
    try {
      await action();
    } catch (e) {
      setNotice({ docId, skipped, error: e instanceof ReviewError ? s.reviewErrors[e.reason] : s.unknownError });
    } finally {
      working.current = false;
      setBusy(false);
      setVersion((v) => v + 1);
    }
  }
  // skippedCount：批次核准時因名稱不完整而略過的筆數（逐筆核准時為 0，清除先前的提示）
  const approveItems = (docId: string, items: { entities: EntityApproval[]; relations: string[] }, skippedCount = 0) =>
    run(docId, () => approve(db, identity, items, { defaultLanguage: client.defaultLanguage }), skippedCount);
  const approveBatch = (docId: string, plan: ReturnType<typeof batchPlan>) =>
    void approveItems(docId, { entities: plan.entities, relations: plan.relations }, plan.skipped);
  const rejectItems = (docId: string, items: { entities: string[]; relations: string[] }) => run(docId, () => reject(db, identity, items));

  const nameOf = (doc: ReviewDocument, id: string) => {
    const e = doc.entities.find((x) => x.id === id);
    return e ? (choiceOf(e).names?.[language] ?? pendingName(e, language)) : id;
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
        <button type="button" className="icon-button" aria-label={s.reviewRefresh} title={s.reviewRefresh} disabled={busy} onClick={() => setVersion((v) => v + 1)}>
          ↻
        </button>
      </div>
      {extracting && <Notice kind="info" title={s.reviewExtracting} action={{ label: s.reviewRefresh, onClick: () => setVersion((v) => v + 1), disabled: busy }} />}
      {visibleDocs.length === 0 && <p className="card muted">{tab === "pending" ? s.reviewEmpty : s.reviewRejectedEmpty}</p>}

      {visibleDocs.map((doc) => {
        const pendingEntities = doc.entities.filter((e) => (tab === "pending" ? e.status === "pending" : e.status === "rejected"));
        const pendingRelations = doc.relations.filter((r) => (tab === "pending" ? r.status === "pending" : r.status === "rejected"));
        const approvedCount = [...doc.entities, ...doc.relations].filter((x) => x.status === "approved").length;
        const batchable = [...pendingEntities.filter((e) => canBatch(suggestions[e.id])).map((e) => e.id), ...pendingRelations.map((r) => r.id)];
        return (
          <section key={doc.id} className="card review-doc">
            {notice?.docId === doc.id && notice.error !== undefined && (
              <Notice kind="error" title={s.noticeReviewTitle} action={{ label: s.reviewRefresh, onClick: () => setVersion((v) => v + 1), disabled: busy }}>
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
                return (
                  <li key={e.id}>
                    {tab === "pending" && (
                      <input type="checkbox" aria-label={pendingName(e, language)} disabled={busy || needsChoice} checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                    )}
                    <span className="badge">{entityTypeLabel(e.type, language)}</span>{" "}
                    {tab === "pending" && choice.mergeInto === null ? (
                      client.languages.map((l) => (
                        <label key={l} className="inline">
                          {l}
                          <input
                            type="text"
                            value={names[l] ?? ""}
                            disabled={busy}
                            onChange={(ev) => setChoice(e.id, { ...choice, names: { ...names, [l]: ev.target.value } })}
                          />
                        </label>
                      ))
                    ) : (
                      <span>{client.languages.map((l) => e.names[l]).join(" / ")}</span>
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
                    <ul>
                      {e.sources.map((p) => (
                        <li key={p.id}>
                          <span lang={p.language}>{p.content}</span>{" "}
                          <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
                            {s.openSource}
                          </button>
                        </li>
                      ))}
                    </ul>
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
                  <ul>
                    {r.sources.map((p) => (
                      <li key={p.id}>
                        <span lang={p.language}>{p.content}</span>{" "}
                        <button type="button" className="link" onClick={() => onOpenSource(p.id)}>
                          {s.openSource}
                        </button>
                      </li>
                    ))}
                  </ul>
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
