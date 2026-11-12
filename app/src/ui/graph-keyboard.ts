// 圖譜的鍵盤操作與螢幕報讀器（#289，docs/design.md「圖譜的鍵盤操作與螢幕報讀器」）：純函式，不依賴 cytoscape。
// 只在 readGraph() 回傳的可見圖上計算（#247）：順序、數量、相關實體與報讀的句子都只涉及目前身分看得到的實體與關係，
// 句子不提及看不到的部分。節點的位置由 GraphView 從 cytoscape 讀出後傳入。
import { fill, strings } from "../client/i18n";
import type { Graph, GraphEntity, GraphRelation } from "../graph/read";
import { relationCounts, topConnected } from "../graph/search";
import { entityOptionLabel, entityTypeLabel, relationTypeLabel } from "./graph-labels";

export type KeyAction = "prev" | "next" | "go" | "back" | "only" | "ask" | "search" | "zoomIn" | "zoomOut" | "fit" | "reset" | "help";

const KEYS: Record<string, KeyAction> = {
  ArrowLeft: "prev",
  ArrowRight: "next",
  Enter: "go",
  Backspace: "back",
  " ": "only",
  a: "ask",
  A: "ask",
  "/": "search",
  "+": "zoomIn",
  "=": "zoomIn",
  "-": "zoomOut",
  "0": "fit",
  Escape: "reset",
  "?": "help",
};

// 按鍵 → 動作；有 Ctrl／Meta／Alt 時不處理（交給瀏覽器與報讀器），Shift 只用來打出 ?、+、A
export function keyAction(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): KeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return Object.hasOwn(KEYS, event.key) ? KEYS[event.key] : null;
}

export interface Neighbor {
  entity: GraphEntity;
  // 目前的實體與它之間的關係（可能不只一種、方向可能不同），依關係 id 排序
  relations: GraphRelation[];
}

export type Positions = ReadonlyMap<string, { x: number; y: number }>;

// 從 12 點鐘方向順時針的角度（畫面座標的 y 向下），0 ≤ angle < 2π
function clockAngle(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const angle = Math.atan2(to.x - from.x, from.y - to.y);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

// 目前實體的相關實體，依版面位置從 12 點鐘方向順時針排序（同角度依 id）；類型篩選掉的不列入。沒有位置時排在最後
export function neighborsClockwise(graph: Graph, current: string, positions: Positions, excluded: ReadonlySet<string>): Neighbor[] {
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const relations = new Map<string, GraphRelation[]>();
  for (const r of graph.relations) {
    if (r.from !== current && r.to !== current) continue;
    const other = r.from === current ? r.to : r.from;
    if (other === current || excluded.has(other) || !byId.has(other)) continue;
    relations.set(other, [...(relations.get(other) ?? []), r]);
  }
  const center = positions.get(current);
  const angle = (id: string) => {
    const p = positions.get(id);
    return center === undefined || p === undefined ? Infinity : clockAngle(center, p);
  };
  return [...relations.entries()]
    .map(([id, rs]) => ({ entity: byId.get(id)!, relations: rs.sort((a, b) => a.id.localeCompare(b.id)), angle: angle(id) }))
    .sort((a, b) => a.angle - b.angle || a.entity.id.localeCompare(b.entity.id))
    .map(({ entity, relations }) => ({ entity, relations }));
}

// Tab 進入時的實體：選取的實體；沒有選取（或已篩選掉）時用關聯最多的實體；都沒有時用第一個沒篩選掉的實體
export function entryEntity(graph: Graph, selected: string | null, excluded: ReadonlySet<string>, language: string): string | null {
  if (selected !== null && !excluded.has(selected) && graph.entities.some((e) => e.id === selected)) return selected;
  const types = new Set(graph.entities.filter((e) => !excluded.has(e.id)).map((e) => e.type));
  return topConnected(graph, language, types)[0]?.entity.id ?? graph.entities.find((e) => !excluded.has(e.id))?.id ?? null;
}

// 游標移動：沒有游標時 → 從第一個、← 從最後一個開始；兩端相接
export function moveCursor(total: number, index: number | null, step: 1 | -1): number | null {
  if (total === 0) return null;
  if (index === null) return step === 1 ? 0 : total - 1;
  return (index + step + total) % total;
}

// 關係說成「主詞 關係 受詞」的完整句子；同一個方向的多種關係合併在同一句（例如「A 隸屬、負責 B」）
export function relationSentences(graph: Graph, relations: GraphRelation[], language: string): string[] {
  const s = strings(language).graphKeyboard;
  const name = (id: string) => {
    const entity = graph.entities.find((e) => e.id === id);
    return entity === undefined ? id : entityOptionLabel(graph, entity, language);
  };
  const byDirection = new Map<string, GraphRelation[]>();
  for (const r of relations) byDirection.set(`${r.from}\n${r.to}`, [...(byDirection.get(`${r.from}\n${r.to}`) ?? []), r]);
  return [...byDirection.values()].map((rs) =>
    fill(s.relation, {
      from: name(rs[0].from),
      relation: [...new Set(rs.map((r) => relationTypeLabel(r.type, language)))].join(s.relationJoin),
      to: name(rs[0].to),
    }),
  );
}

// 看得到、沒有篩選掉的實體與關係數（關係的兩端都沒篩選掉才算）
function visibleCounts(graph: Graph, excluded: ReadonlySet<string>) {
  return {
    entities: graph.entities.filter((e) => !excluded.has(e.id)).length,
    relations: graph.relations.filter((r) => !excluded.has(r.from) && !excluded.has(r.to)).length,
  };
}

function describe(graph: Graph, id: string, language: string) {
  const entity = graph.entities.find((e) => e.id === id);
  return {
    name: entity === undefined ? id : entityOptionLabel(graph, entity, language),
    type: entity === undefined ? "" : entityTypeLabel(entity.type, language),
    count: relationCounts(graph).get(id) ?? 0,
  };
}

// 進入圖譜：知識圖譜，{entities} 個實體、{relations} 段關係。目前：{name}，{type}，關聯 {count}。
export function announceEnter(graph: Graph, current: string | null, excluded: ReadonlySet<string>, language: string): string {
  const s = strings(language).graphKeyboard;
  const head = fill(s.enter, visibleCounts(graph, excluded), language);
  return current === null ? head : `${head}${fill(s.current, describe(graph, current, language), language)}`;
}

// 移動游標：{index}／{total}：{name}。{from} {relation} {to}。
export function announceMove(graph: Graph, neighbors: Neighbor[], index: number, language: string): string {
  const s = strings(language).graphKeyboard;
  const { entity, relations } = neighbors[index];
  return fill(s.move, {
    index: index + 1,
    total: neighbors.length,
    name: entityOptionLabel(graph, entity, language),
    relations: relationSentences(graph, relations, language).join(s.sentenceJoin),
  });
}

// 前往：前往 {name}，{type}，關聯 {count}。
export const announceGo = (graph: Graph, id: string, language: string) => fill(strings(language).graphKeyboard.go, describe(graph, id, language), language);

// 篩選後與回到全部：顯示 {entities} 個實體。
export const announceShown = (graph: Graph, excluded: ReadonlySet<string>, language: string) =>
  fill(strings(language).graphKeyboard.shown, { entities: visibleCounts(graph, excluded).entities }, language);

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const ANNOUNCE_DEBOUNCE_MS = 200;

// 報讀的去抖：連續呼叫時只在最後一次之後 delay 毫秒寫入一次
export function createAnnouncer(write: (text: string) => void, timers: Timers = globalThis as unknown as Timers, delay = ANNOUNCE_DEBOUNCE_MS) {
  let handle: unknown = null;
  const cancel = () => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };
  return {
    say(text: string) {
      cancel();
      handle = timers.setTimeout(() => {
        handle = null;
        write(text);
      }, delay);
    },
    cancel,
  };
}
