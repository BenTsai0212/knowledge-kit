// 切段：把擷取出的純文字切成段落（docs/upload.md）。
// 1. 以空行分段；段落內的換行在兩側都是漢字或全形標點時直接相連，否則換成空白
// 2. 很短的段落（通常是標題）併入下一段，讓標題留在內容的段落中
// 3. 超過 maxChars 的段落依句尾斷開（中文的「。！？」、英文的 . ! ? 後接空白）
// 4. 單句仍超過上限時硬切
import { MAX_PASSAGES, ParseError } from "./parse";

export const SHORT_PARAGRAPH_CHARS = 20;

// 漢字與全形標點（，。！？、：等）：相連時不加空白
const CJK = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;

function joinLines(paragraph: string): string {
  const lines = paragraph.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return lines.reduce((out, line) => (out === "" ? line : CJK.test(out.at(-1)!) && CJK.test(line[0]) ? out + line : `${out} ${line}`), "");
}

function sentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[。！？])|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function hardSplit(text: string, maxChars: number): string[] {
  const chars = [...text];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) out.push(chars.slice(i, i + maxChars).join(""));
  return out;
}

// 長度以字元（code point）計算
const length = (text: string) => [...text].length;

function splitLong(paragraph: string, maxChars: number): string[] {
  if (length(paragraph) <= maxChars) return [paragraph];
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences(paragraph)) {
    const joined = current === "" ? sentence : CJK.test(current.at(-1)!) ? current + sentence : `${current} ${sentence}`;
    if (length(joined) <= maxChars) {
      current = joined;
      continue;
    }
    if (current !== "") out.push(current);
    if (length(sentence) <= maxChars) current = sentence;
    else {
      const pieces = hardSplit(sentence, maxChars);
      out.push(...pieces.slice(0, -1));
      current = pieces.at(-1)!;
    }
  }
  if (current !== "") out.push(current);
  return out;
}

export function chunk(text: string, maxChars: number): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map(joinLines)
    .filter((p) => p !== "");

  const merged: string[] = [];
  let pending = "";
  for (const p of paragraphs) {
    const withHeading = pending === "" ? p : `${pending} ${p}`;
    if (length(p) <= SHORT_PARAGRAPH_CHARS) pending = withHeading;
    else {
      merged.push(withHeading);
      pending = "";
    }
  }
  if (pending !== "") merged.push(pending);

  const passages = merged.flatMap((p) => splitLong(p, maxChars));
  if (passages.length > MAX_PASSAGES) throw new ParseError("too_long");
  return passages;
}
