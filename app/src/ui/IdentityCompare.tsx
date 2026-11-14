// 身分對照（#261，docs/design.md「展示模式」的「身分對照」）：同一題以每個身分各回答一次，依身分順序並排成欄，目前身分的欄用 primary 框線。
// 每一欄都是一般問答的 AnswerView（拒答與下一步、錯誤、引用都相同），標題換成該欄的身分；不顯示數量、權限等級或「有內容被隱藏」的提示（#247）。
// 外層不套卡片、每欄本身是卡片：身分標題是膠囊，題目是與問答相同的大字泡泡，各欄等高（#349，畫板 H-QA）。
// 各欄逐欄出現（stagger 80ms，--column 是 staggerIndex，不用 --i 以免欄內的元素繼承；減少動態效果時直接到位）。送出與取消由 App 以 qa/compare.ts 的 askEach() 處理
import type { CSSProperties } from "react";
import { strings } from "../client/i18n";
import type { Graph } from "../graph/read";
import { AnswerView, type AnswerState, type OpenEntity } from "./AnswerView";
import { EmptyState } from "./EmptyState";
import { columnStarted, type CompareColumn } from "./identity-compare";
import { staggerIndex } from "./motion";
import { Notice } from "./Notice";

// 一次對照（App 的狀態）：run 每次送出加一（欄的元素 id 用它區分，回答的動態每次都重播）
export interface CompareRun {
  run: number;
  // 目前的題目；還沒有題目時是 null
  question: string | null;
  // 這個分頁已用完提問次數：只顯示說明、不送出（canStartCompare()）
  limited: boolean;
  // 第 i 欄（身分順序）的回答；還沒有文字的欄沒有項目
  answers: Readonly<Record<number, AnswerState>>;
  // 已有結果的欄數（依序送出，所以第 finished 欄是正在送出的欄）
  finished: number;
}

interface Props {
  language: string;
  columns: readonly CompareColumn[];
  compare: CompareRun;
  canUpload(role: string): boolean;
  // 以該欄的身分打開原文
  onOpenSource(role: string, passageId: string): void;
  openPassage: string | null;
  onGotoUpload(): void;
  onOpenEntity(graph: Graph, entityId: string): void;
  openEntity: OpenEntity | null;
  // 「重新提問」：整組重新送出；對照進行中不能按
  onRetry(): void;
  retryDisabled: boolean;
  onDraft(question: string): void;
  onViewInGraph(role: string, entityId: string): void;
}

const NO_REPORT = () => Promise.resolve(null);

export function IdentityCompare({ language, columns, compare, canUpload, onOpenSource, openPassage, onGotoUpload, onOpenEntity, openEntity, onRetry, retryDisabled, onDraft, onViewInGraph }: Props) {
  const s = strings(language);
  const { question } = compare;
  return (
    <section className="compare" aria-label={s.presentation.compare}>
      {compare.limited ? (
        <Notice kind="warning" title={s.presentation.compareLimited} />
      ) : question === null ? (
        <EmptyState icon="question" title={s.presentation.compare} reason={s.presentation.compareEmpty} as="div" />
      ) : (
        <>
          <h2 className="compare__question">{question}</h2>
          <div className="compare__columns" style={{ "--columns": columns.length } as CSSProperties}>
            {columns.map((column, index) => {
              const state = compare.answers[index] ?? { question, streaming: "" };
              const started = columnStarted(index, compare.finished);
              return (
                <div
                  key={`${compare.run}-${column.role}`}
                  className={column.current ? "compare__column is-current" : "compare__column"}
                  data-role={column.role}
                  style={{ "--column": staggerIndex(index) } as CSSProperties}
                >
                  {/* 目前身分在畫面上以 primary 框線表示（#349，畫板 H-QA），文字只給報讀器 */}
                  {column.current && <p className="visually-hidden">{s.presentation.compareCurrent}</p>}
                  {started ? (
                    <AnswerView
                      id={`compare-${compare.run}-${column.role}`}
                      heading={column.label}
                      language={language}
                      state={state}
                      canUpload={canUpload(column.role)}
                      onOpenSource={(passageId) => onOpenSource(column.role, passageId)}
                      openPassage={openPassage}
                      onGotoUpload={onGotoUpload}
                      onOpenEntity={onOpenEntity}
                      openEntity={openEntity}
                      readReport={NO_REPORT}
                      onRetry={onRetry}
                      retryDisabled={retryDisabled}
                      onShorten={() => onDraft(question)}
                      onDraft={onDraft}
                      onViewInGraph={(id) => onViewInGraph(column.role, id)}
                    />
                  ) : (
                    <section className="card answer compare__waiting">
                      <h2>{column.label}</h2>
                      <p className="muted">{s.presentation.compareWaiting}</p>
                    </section>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
