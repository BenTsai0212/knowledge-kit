// 問答的說法不同提問（ADR 0012 決定 1、3、4，docs/qa.md「說法不同的提問」，畫板 S-QA 的 ③～⑧）：回答引用的兩段屬於一組
// 已處理為「並存」的說法不同時，回答結束後在卡片內問一次。選項是存下來的假設（或固定範本），另有「都不是，我來說明」與「略過」。
// 選了之後補一句證據，或以「另一種讀法」溫和地提出另一種可能一次；最後寫入人的理解（interpretations）。不改變回答與兩段原文。
// 略過只記在本次工作階段（onSkip）。進度記在模組層級，切換頁籤重新掛載時沿用。
// 留下理解或略過之後（或之前已對這一組作答，answered），卡片內顯示「記錄」：自己的與同事的理解（SeamRecords，ADR 0012 決定 6）
import { useEffect, useState, type ReactNode } from "react";
import { fill, strings } from "../client/i18n";
import { byDate, monthsBetween, seamReply, usesTemplate } from "../conflicts/dialogue";
import { OTHER_CHOICE, type Interpretation } from "../conflicts/interpretations";
import type { ConflictItem } from "../conflicts/store";
import { AskCard } from "./AskCard";
import { SeamRecords } from "./SeamRecords";

export interface SeamRecord {
  choice: string;
  changedAfterChallenge: boolean;
  note: string | null;
}

export interface SeamActions {
  // 寫入人的理解；失敗時 reject
  record(x: SeamRecord): Promise<void>;
  skip(): void;
  // 這一組目前身分看得到的理解（RLS）；失敗時 reject
  read(): Promise<Interpretation[]>;
}

interface Props extends SeamActions {
  // 這一題的 id（進度的鍵）
  id: string;
  language: string;
  seam: ConflictItem;
  // 之前已對這一組留下理解：不再提問，只顯示記錄
  answered?: boolean;
  onOpenSource(passageId: string): void;
}

// first：第一次的選擇（選項的位置，或「都不是，我來說明」）；second：另一種讀法之後改了或維持
type Progress =
  | { step: "ask" }
  | { step: "challenge"; first: number }
  | { step: "done"; first: number | "other"; note?: string; second?: "change" | "keep"; status: "saving" | "saved" | "failed" }
  | { step: "skipped" }
  | { step: "answered" };

const progressOf = new Map<string, Progress>();

export function SeamDialogue({ id, language, seam, answered = false, onOpenSource, record, skip, read }: Props) {
  const s = strings(language);
  const [progress, setProgress] = useState<Progress>(() => progressOf.get(id) ?? { step: answered ? "answered" : "ask" });
  const save = (next: Progress) => (progressOf.set(id, next), setProgress(next));
  // 記錄：寫入成功、略過或之前已作答後才讀（先作答才看得到同事的理解）
  const unlocked = progress.step === "answered" || progress.step === "skipped" || (progress.step === "done" && progress.status === "saved");
  const [records, setRecords] = useState<Interpretation[] | null>(null);
  useEffect(() => {
    if (!unlocked) return;
    let live = true;
    read().then(
      (items) => void (live && setRecords(items)),
      () => void (live && setRecords(null)),
    );
    return () => void (live = false);
    // read 每次 render 都是新的函式；只在解鎖時讀一次
  }, [unlocked]);
  const recordView = records !== null && (
    <SeamRecords language={language} items={records} skipped={progress.step === "skipped"} title={s.dialogueRecordTitle} showLocked={false} />
  );

  const template = usesTemplate(seam);
  // 固定範本的選項依 TEMPLATE_CHOICES 的順序
  const labels = template ? [s.dialogueChoiceChanged, s.dialogueChoiceDifferent, s.dialogueChoiceWrong] : seam.hypotheses!;
  const { newer, older } = byDate(seam);
  const months = monthsBetween(older.date, newer.date);
  const question = template ? fill(s.dialogueConflictTemplate, { newer: newer.documentTitle, older: older.documentTitle, months }, language) : s.dialogueConflictAsk;

  const write = (done: Extract<Progress, { step: "done" }>, x: SeamRecord) => {
    save(done);
    record(x).then(
      () => save({ ...done, status: "saved" }),
      () => save({ ...done, status: "failed" }),
    );
  };
  const choose = (i: number) => {
    const reply = seamReply(seam, i);
    if (reply.kind === "challenge" || reply.kind === "challengeDate") save({ step: "challenge", first: i });
    else write({ step: "done", first: i, status: "saving" }, { choice: labels[i], changedAfterChallenge: false, note: null });
  };

  if (progress.step === "skipped")
    return (
      <>
        <p className="muted seam-skipped">{s.dialogueSkipped}</p>
        {recordView}
      </>
    );
  if (progress.step === "answered") return recordView || null;

  const first = progress.step === "ask" ? null : progress.first;
  const reply = typeof first === "number" ? seamReply(seam, first) : null;
  const bubble = (text: string) => <p className="refusal-chosen__choice">{text}</p>;
  const supplement = (text: ReactNode) => (
    <p className="seam-add">
      <span className="seam-add__label">{s.dialogueSupplement}</span>
      {text}
    </p>
  );
  const recorded = progress.step === "done" && progress.status !== "saving" && (progress.status === "saved" ? s.dialogueRecorded : s.dialogueRecordFailed);

  return (
    <div className="seam-dialogue">
      <AskCard
        language={language}
        title={s.seamTitle}
        question={question}
        options={labels.map((label, i) => ({ key: `h${i}`, label, onChoose: () => choose(i) }))}
        onExplain={(note) => write({ step: "done", first: "other", note, status: "saving" }, { choice: OTHER_CHOICE, changedAfterChallenge: false, note: note || null })}
        explainHint={s.dialogueExplainHint}
        exits={[{ key: "skip", label: s.dialogueSkip, onChoose: () => (save({ step: "skipped" }), skip()) }]}
        held={progress.step === "ask" ? undefined : null}
      />
      {first === "other" && (
        <div className="refusal-chosen">
          {bubble(s.commonExplain)}
          {progress.step === "done" && progress.note && bubble(progress.note)}
        </div>
      )}
      {typeof first === "number" && <div className="refusal-chosen">{bubble(labels[first])}</div>}
      {reply?.kind === "evidence" && recorded && supplement(`${fill(s.dialogueEvidence, { title: reply.passage.documentTitle, quote: reply.quote })}${recorded}`)}
      {(reply?.kind === "challenge" || reply?.kind === "challengeDate") && (
        <Alternative
          language={language}
          text={
            reply.kind === "challenge" ? (
              <Marked template={fill(s.dialogueAltEvidence, { choice: labels[reply.to], title: reply.passage.documentTitle, quote: "\u0000" })} quote={reply.quote} />
            ) : (
              fill(s.dialogueAltDate, { newer: newer.documentTitle, older: older.documentTitle, months: reply.months }, language)
            )
          }
          onCompare={() => onOpenSource(reply.kind === "challenge" ? reply.passage.id : newer.id)}
          change={fill(s.dialogueAltChange, { choice: labels[reply.to] })}
          // 改了：記成證據支持的假設；維持：照原本的選擇記錄，不再說服
          onChoose={
            progress.step === "challenge"
              ? (second) =>
                  write(
                    { step: "done", first: progress.first, second, status: "saving" },
                    { choice: labels[second === "change" ? reply.to : progress.first], changedAfterChallenge: second === "change", note: null },
                  )
              : null
          }
        />
      )}
      {progress.step === "done" && progress.second !== undefined && (
        <div className="refusal-chosen">{bubble(progress.second === "keep" ? s.dialogueAltKeep : fill(s.dialogueAltChange, { choice: labels[(reply as { to: number }).to] }))}</div>
      )}
      {recorded && reply?.kind !== "evidence" && supplement(recorded)}
      {recordView}
    </div>
  );
}

// 文字中的 \u0000 換成以 mark 標出的證據
function Marked({ template, quote }: { template: string; quote: string }) {
  const [before, after = ""] = template.split("\u0000");
  return (
    <>
      {before}
      <mark>{quote}</mark>
      {after}
    </>
  );
}

// 另一種讀法（docs/design.md「AI 發言的外觀」）：markSoft 底、mark 色細邊、「↺」、小標；附「對照原文」。onChoose 為 null 時已選過
function Alternative({ language, text, onCompare, change, onChoose }: { language: string; text: ReactNode; onCompare(): void; change: string; onChoose: ((second: "change" | "keep") => void) | null }) {
  const s = strings(language);
  return (
    <div className="seam-alt" role="group" aria-label={s.dialogueAltTitle}>
      <span className="seam-alt__icon" aria-hidden="true">
        ↺
      </span>
      <div className="seam-alt__main">
        <p className="seam-alt__title">{s.dialogueAltTitle}</p>
        <p className="seam-alt__text">{text}</p>
        <button type="button" className="seam-alt__compare" onClick={onCompare}>
          {s.dialogueAltCompare}
        </button>
        {onChoose !== null && (
          <>
            <div className="refusal-ask__options">
              <button type="button" onClick={() => onChoose("change")}>
                {change}
              </button>
              <button type="button" onClick={() => onChoose("keep")}>
                {s.dialogueAltKeep}
              </button>
            </div>
            <p className="refusal-ask__turn">{s.dialogueAltTurn}</p>
          </>
        )}
      </div>
    </div>
  );
}
