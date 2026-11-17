// 請上傳者確認的提問（ADR 0011 決定 6，畫板 docs/design/v1/boards/S-Request.dc.html）：上傳者首頁「有更新」裡的 AI 在問你的卡片。
// 小標是誰在問、哪一份文件；選項與審核者相同，加上「都不是，我來說明」，沒有「請上傳者確認」。上傳者沒有 canReview，
// 回答只是說明（extraction/requests.ts 的 replyToRequest()），由審核者決定；送出後回答是右側的泡泡，下方是「已送出」。
// 提問與選項依上傳者看得到的實體（seam-review.ts 的 requestSeam()）；名稱與說明以文字節點顯示
import { useState } from "react";
import { fill, strings } from "../client/i18n";
import type { Database } from "../db/database";
import { replyToRequest, type RequestReply } from "../extraction/requests";
import { ReviewError } from "../extraction/store";
import type { Graph } from "../graph/read";
import { AskCard } from "./AskCard";
import { relationTypeLabel } from "./graph-labels";
import { roleLabel } from "./ReportResult";
import { SeamItem } from "./SeamItem";
import type { UploaderAsk } from "./seam-review";
import { relationQuestion, replyLabel, replyOf, seamQuestion } from "./seam-text";

interface Props {
  db: Database;
  identity: string;
  language: string;
  // 上傳者看得到的圖譜（合併對象的名稱）
  graph: Graph;
  item: UploaderAsk;
  // 送出後重新讀取
  onReplied(): void;
}

export function RequestAsk({ db, identity, language, graph, item, onReplied }: Props) {
  const s = strings(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { request, doc, ask } = item;
  const name = roleLabel(request.requestedBy, language);
  const nameOf = (id: string) => {
    const e = doc.entities.find((x) => x.id === id);
    return e === undefined ? id : e.names[doc.language] || Object.values(e.names)[0] || id;
  };
  const seam = ask.kind === "entity" ? ask.seam : undefined;
  const label = (reply: RequestReply) => replyLabel(s, reply.choice, reply.mergeInto ?? null, graph, language, seam);
  const send = (reply: RequestReply) => {
    setBusy(true);
    setError(null);
    replyToRequest(db, identity, request.id, reply)
      .then(onReplied, (e: unknown) => setError(e instanceof ReviewError ? s.reviewErrors[e.reason] : s.unknownError))
      .finally(() => setBusy(false));
  };
  const relation = ask.kind === "relation" ? ask.seam.relation : undefined;
  const itemName =
    ask.kind === "entity" ? nameOf(ask.seam.entity.id) : `${nameOf(relation!.from)} —${relationTypeLabel(relation!.type, language)}→ ${nameOf(relation!.to)}`;
  const sent = request.reply;
  return (
    <AskCard
      language={language}
      title={fill(s.seamRequestTitle, { name, title: doc.title }, language)}
      question={ask.kind === "entity" ? seamQuestion(s, ask.seam, itemName, language) : relationQuestion(s, ask.seam.unsure, itemName, language)}
      busy={busy}
      turn={fill(s.seamRequestTurn, { name }, language)}
      onExplain={(note) => send({ choice: "other", note })}
      options={ask.seam.options.map((o) => ({ key: o.kind === "merge" ? o.target : o.kind, label: label(replyOf(o)), onChoose: () => send(replyOf(o)) }))}
      held={
        sent === null ? undefined : (
          <div className="ask-card__explain">
            <p className="refusal-chosen__choice">{sent.note ?? label({ choice: sent.choice, mergeInto: sent.mergeInto ?? undefined })}</p>
            <p className="muted">{fill(s.seamRequestSent, { name }, language)}</p>
          </div>
        )
      }
    >
      <SeamItem language={language} entityType={seam?.entity.type} name={itemName} nameLanguage={doc.language} />
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </AskCard>
  );
}
