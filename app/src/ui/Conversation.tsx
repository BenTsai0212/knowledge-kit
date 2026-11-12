import { useEffect, useRef } from "react";
import type { Graph } from "../graph/read";
import { strings } from "../client/i18n";
import type { AnswerReport, ReportCategory } from "../reports/store";
import { AnswerView, type AnswerState, type OpenEntity } from "./AnswerView";
import { focusPresets } from "./empty-state";
import { EmptyState } from "./EmptyState";

// 一題問答；id 也是畫面上的元素 id（左側「這次的問題」捲到該題）
export interface Turn extends AnswerState {
  id: string;
}

interface Props {
  language: string;
  turns: readonly Turn[];
  canUpload: boolean;
  // 引用標號：連同是哪一題（手機原文面板的「出處 N／M」，#256）
  onOpenSource(passageId: string, turnId: string): void;
  // 目前在原文面板中的段落（#225）
  openPassage: string | null;
  onGotoUpload(): void;
  onOpenEntity(graph: Graph, entityId: string): void;
  // 目前在右側實體面板中的實體（#198）
  openEntity: OpenEntity | null;
  // 「回報有錯」（ADR 0007 決定 7）；沒有時不顯示（展示模式，#260）
  onReport?(turn: Turn, category: ReportCategory, note: string): Promise<void>;
  // 回答下方的回報結果（#286）
  readReport(reportId: string): Promise<AnswerReport | null>;
  // 回答中斷時的「重新提問」（#227）：與輸入區送出相同；askDisabled 時不能按
  onAsk(question: string): void;
  askDisabled: boolean;
  // 問句填進輸入框，不送出：prompt_too_long 的「縮短問題」（#280）、拒答的「換個問法」（#285）
  onDraft(question: string): void;
  // 拒答的「在圖譜看它」（#285）
  onViewInGraph(entityId: string): void;
  // 手機原文面板的「回報有錯」（#256）：要回報的題目與要求的次數（每按一次加一）
  reportRequest?: { turn: string; count: number } | null;
}

// 問答依序往下累積（#195）；新的一題出現時捲到該題
export function Conversation({ language, turns, canUpload, onOpenSource, openPassage, onGotoUpload, onOpenEntity, openEntity, onReport, readReport, onAsk, askDisabled, onDraft, onViewInGraph, reportRequest = null }: Props) {
  const s = strings(language);
  const latest = turns.at(-1)?.id;
  const latestRef = useRef<HTMLElement>(null);
  // 不可寫成 () => …scrollIntoView()：新版瀏覽器的 scrollIntoView 回傳 Promise，React 會把它當成 cleanup 呼叫而出錯
  useEffect(() => {
    void latestRef.current?.scrollIntoView({ block: "start" });
  }, [latest]);

  return (
    <div className="conversation">
      {turns.length === 0 ? (
        // 尚未提問（#245）：下一步是輸入區的預設問題
        <EmptyState
          icon="question"
          title={s.emptyAnswer}
          reason={s.emptyAnswerReason}
          actions={[{ label: s.emptyAnswerAction, onClick: focusPresets, disabled: askDisabled }]}
        />
      ) : (
        turns.map((turn) => (
          <AnswerView
            key={turn.id}
            ref={turn.id === latest ? latestRef : undefined}
            id={turn.id}
            language={language}
            state={turn}
            canUpload={canUpload}
            onOpenSource={(passageId) => onOpenSource(passageId, turn.id)}
            openPassage={openPassage}
            onGotoUpload={onGotoUpload}
            onOpenEntity={onOpenEntity}
            openEntity={openEntity}
            onReport={onReport && ((category, note) => onReport(turn, category, note))}
            readReport={readReport}
            onRetry={() => onAsk(turn.question)}
            retryDisabled={askDisabled}
            onShorten={() => onDraft(turn.question)}
            onDraft={onDraft}
            onViewInGraph={onViewInGraph}
            reportRequest={reportRequest?.turn === turn.id ? reportRequest.count : 0}
          />
        ))
      )}
    </div>
  );
}
