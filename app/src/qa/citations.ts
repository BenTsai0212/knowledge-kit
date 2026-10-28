// 回答中的引用：以 [n] 引用 prompt 中的段落編號，轉成段落 id。[1, 3] 這類寫法也接受，統一成 [1][3]。
const CITATION = /(\s*)\[(\d+(?:\s*,\s*\d+)*)\]/g;

export interface ResolvedCitations {
  // 移除不存在的編號後的文字
  text: string;
  // 有效引用的段落 id，依第一次出現的順序、不重複
  cited: string[];
  // 不存在的編號
  dropped: number[];
}

export function resolveCitations(text: string, numbering: string[]): ResolvedCitations {
  const cited = new Set<string>();
  const dropped: number[] = [];
  const resolved = text.replace(CITATION, (_match, space: string, list: string) => {
    const kept = list.split(",").flatMap((s) => {
      const n = Number(s.trim());
      const id = n >= 1 ? numbering[n - 1] : undefined;
      if (id === undefined) {
        dropped.push(n);
        return [];
      }
      cited.add(id);
      return [`[${n}]`];
    });
    // 整組都不存在時，連同前面的空白一起移除
    return kept.length > 0 ? space + kept.join("") : "";
  });
  return { text: resolved, cited: [...cited], dropped };
}

export type Segment = { text: string } | { citation: number };

// 畫面顯示用：把文字切成一般文字與引用編號（[1, 3] 也拆成兩個引用）
export function splitCitations(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) });
    for (const n of m[1].split(",")) segments.push({ citation: Number(n.trim()) });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
