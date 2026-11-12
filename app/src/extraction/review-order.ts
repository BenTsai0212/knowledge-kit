// 待審區的排列（#243 PR 3 審查）：依項目在文件中出現的順序，不依 id。
// 待審項目的 id 是萃取時產生的隨機值（newPendingEntityId），依 id 排列和文件無關、每次萃取都不同；
// 這裡改依第一個出處段落的順序、名稱在該段落中最早出現的位置排列，最後才比 id（同位置時固定）。

// 項目的第一個出處段落（段落順序最小的那一段）
export interface FirstSource {
  ordinal: number;
  content: string;
}

// 名稱在段落中最早出現的位置（不分大小寫）；都找不到時排在該段落的最後
export function namePosition(content: string, names: readonly string[]): number {
  const lower = content.toLowerCase();
  const found = names
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n !== "")
    .map((n) => lower.indexOf(n))
    .filter((i) => i >= 0);
  return found.length > 0 ? Math.min(...found) : Number.POSITIVE_INFINITY;
}

// 排列的鍵：第一個出處段落的順序，接著是每組名稱在該段落中的位置；沒有出處的排在最後
export function appearanceKey(first: FirstSource | undefined, nameGroups: readonly (readonly string[])[]): number[] {
  if (first === undefined) return [Number.POSITIVE_INFINITY];
  return [first.ordinal, ...nameGroups.map((names) => namePosition(first.content, names))];
}

// 依鍵排列，鍵相同時依 id；不改動傳入的陣列
export function byAppearance<T extends { id: string }>(items: readonly T[], key: (item: T) => number[]): T[] {
  const keys = new Map(items.map((x) => [x.id, key(x)]));
  return [...items].sort((a, b) => {
    const ka = keys.get(a.id)!;
    const kb = keys.get(b.id)!;
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const x = ka[i] ?? Number.NEGATIVE_INFINITY;
      const y = kb[i] ?? Number.NEGATIVE_INFINITY;
      if (x !== y) return x < y ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
