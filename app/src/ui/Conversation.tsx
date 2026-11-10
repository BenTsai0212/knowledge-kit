import { useEffect, useRef } from "react";
import type { Graph } from "../graph/read";
import { strings } from "../client/i18n";
import type { ReportCategory } from "../reports/store";
import { AnswerView, type AnswerState, type OpenEntity } from "./AnswerView";

// 一題問答；id 也是畫面上的元素 id（左側「這次的問題」捲到該題）
export interface Turn extends AnswerState {
  id: string;
}

interface Props {
  language: string;
  turns: readonly Turn[];
  canUpload: boolean;
  onOpenSource(passageId: string): void;
  onGotoUpload(): void;
  onOpenEntity(graph: Graph, entityId: string): void;
  // 目前在右側實體面板中的實體（#198）
  openEntity: OpenEntity | null;
  // 「回報有錯」（ADR 0007 決定 7）
  onReport(turn: Turn, category: ReportCategory, note: string): Promise<void>;
}

// 問答依序往下累積（#195）；新的一題出現時捲到該題
export function Conversation({ language, turns, canUpload, onOpenSource, onGotoUpload, onOpenEntity, openEntity, onReport }: Props) {
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
        <section className="card muted">{s.emptyAnswer}</section>
      ) : (
        turns.map((turn) => (
          <AnswerView
            key={turn.id}
            ref={turn.id === latest ? latestRef : undefined}
            id={turn.id}
            language={language}
            state={turn}
            canUpload={canUpload}
            onOpenSource={onOpenSource}
            onGotoUpload={onGotoUpload}
            onOpenEntity={onOpenEntity}
            openEntity={openEntity}
            onReport={(category, note) => onReport(turn, category, note)}
          />
        ))
      )}
    </div>
  );
}
