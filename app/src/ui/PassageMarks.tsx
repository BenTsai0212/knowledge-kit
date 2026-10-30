// 段落旁的標示（#51）：「與〈文件〉的說法不同」「已由〈文件〉取代」「取代〈文件〉的說法」，點擊後打開另一段的原文。
// 標示由資料層經 RLS 讀出，只有看得到另一段時才有；文件標題以文字節點顯示。
import type { PassageMark } from "../conflicts/marks";
import { fill, strings } from "../client/i18n";

interface Props {
  marks: PassageMark[];
  language: string;
  onOpenSource(passageId: string): void;
}

export function PassageMarks({ marks, language, onOpenSource }: Props) {
  const s = strings(language);
  if (marks.length === 0) return null;
  return (
    // 介面語言的文字；原文面板中外層是文件的語言
    <span className="passage-marks" lang={language}>
      {marks.map((m) => (
        <button key={`${m.kind}|${m.passageId}`} type="button" className={`badge mark-${m.kind}`} onClick={() => onOpenSource(m.passageId)}>
          {fill(s.conflictMarks[m.kind], { title: m.documentTitle })}
        </button>
      ))}
    </span>
  );
}
