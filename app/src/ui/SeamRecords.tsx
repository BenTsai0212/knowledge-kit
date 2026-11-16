// 人的理解的「記錄」（docs/design.md「AI 發言的外觀」的記錄，畫板 S-QA）：沒有框，上方虛線、textMuted 小標，
// 附角色與日期；不用綠色或勾勾。回答卡片（SeamDialogue）與原文欄（SourceText）共用。不改變兩種說法的並列
import { fill, strings } from "../client/i18n";
import { OTHER_CHOICE, type Interpretation } from "../conflicts/interpretations";
import { roleLabel } from "./ReportResult";
import { recordRows } from "./seam-records";

interface Props {
  language: string;
  // 同一組的理解（seam-records.ts 的 pairRecords()）
  items: readonly Interpretation[];
  // 本次工作階段已略過這一組
  skipped: boolean;
  title: string;
  // 還沒作答時顯示「先留下你的理解或略過…」（原文欄）；false 時不顯示任何東西（回答卡片）
  showLocked: boolean;
}

export function SeamRecords({ language, items, skipped, title, showLocked }: Props) {
  const s = strings(language);
  const { mine, peers, locked } = recordRows(items, skipped);
  // 介面語言的文字；原文欄中外層是文件的語言
  if (locked)
    return showLocked ? (
      <p className="muted seam-record__locked" lang={language}>
        {s.dialogueRecordLocked}
      </p>
    ) : null;
  if (mine.length + peers.length === 0) return null;
  const date = new Intl.DateTimeFormat(language, { month: "numeric", day: "numeric" });
  const row = (i: Interpretation, who: string) => (
    <p key={i.id} className="seam-record__row">
      <span>{i.choice === OTHER_CHOICE ? (i.note ?? s.commonExplain) : i.choice}</span>
      <span className="seam-record__who">{who}</span>
    </p>
  );
  const meta = (i: Interpretation) => ({ role: roleLabel(i.createdBy, language), date: date.format(new Date(i.createdAt)) });
  return (
    <div className="seam-record" role="group" aria-label={title} lang={language}>
      <p className="seam-record__label">{title}</p>
      {mine.map((i) => row(i, fill(s.dialogueRecordMine, meta(i))))}
      {peers.length > 0 && <p className="seam-record__label">{s.dialogueRecordPeers}</p>}
      {peers.map((i) => row(i, fill(s.dialogueRecordPeer, meta(i))))}
    </div>
  );
}
