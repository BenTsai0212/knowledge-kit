// 模型有時把整段回答包在自訂標籤裡（例如 <citation_response>…</citation_response>，#237）。
// 顯示前只移除整段回答外層成對的標籤，不動內文中看似標籤的文字。
const OPEN = /^\s*<([A-Za-z][\w.:-]*)(?:\s[^<>]*)?>/;
// 還沒收完的開頭標籤：「<」或「<名稱 屬性」還沒有「>」
const PARTIAL_OPEN = /^\s*<(?:[A-Za-z][\w.:-]*(?:\s[^<>]*)?)?$/;
// 巢狀包裝（例如 <answer><citation_response>…）最多拆幾層
const MAX_DEPTH = 3;

// complete：回答已正常結束。true 時只移除成對的外層標籤；
// false（串流中、被截斷或中斷）時結尾標籤可能還沒收到，開頭標籤完整就先移除，並隱藏結尾還沒收完的結尾標籤
export function unwrapAnswer(text: string, complete: boolean): string {
  let out = text;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (!complete && PARTIAL_OPEN.test(out)) return "";
    const next = unwrapOnce(out, complete);
    if (next === null) return out;
    out = next;
  }
  return out;
}

function unwrapOnce(text: string, complete: boolean): string | null {
  const open = text.match(OPEN);
  if (open === null) return null;
  const close = `</${open[1]}>`;
  const rest = text.slice(open[0].length);
  const at = rest.indexOf(close);
  if (at >= 0) {
    // 第一個結尾標籤之後還有文字：不是包住整段回答的外層（例如 <b>重點</b>：…）
    if (rest.slice(at + close.length).trim() !== "") return null;
    return rest.slice(0, at).trim();
  }
  if (complete) return null;
  return withoutPartialClose(rest, close).trimStart();
}

// 去掉結尾「</名稱>」還沒收完的部分（例如「</citation_」）
function withoutPartialClose(text: string, close: string): string {
  for (let n = Math.min(close.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(close.slice(0, n))) return text.slice(0, -n).trimEnd();
  }
  return text;
}
