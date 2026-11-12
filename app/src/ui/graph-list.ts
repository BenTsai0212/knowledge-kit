// 圖譜的清單模式（#289，docs/design.md「圖譜的鍵盤操作與螢幕報讀器」的「容器與清單模式」）：以文字列出同一份可見圖，
// 群組 → 實體 → 關係句。純函式，只用 readGraph() 回傳的可見圖（#247）：實體、關係與句中的名稱都只涉及目前身分看得到的部分。
// 群組是大量節點時的分群（#254 決定 5，clusterGraph()：容器類型／社群偵測／「其他」），與圖譜的全覽相同；
// 分群也只用可見圖計算，所以群組與群組名稱只涉及目前身分看得到的實體。
import { strings } from "../client/i18n";
import type { ClusterKind, Clustering } from "../graph/clusters";
import { focusOf, type Expansion } from "../graph/expansion";
import type { Graph, GraphEntity, GraphRelation } from "../graph/read";
import { relationSentenceParts, type SentencePart } from "./graph-keyboard";
import { entityOptionLabel } from "./graph-labels";

export interface ListEntity {
  entity: GraphEntity;
  label: string;
  // 每個相關實體一句或兩句（兩個方向各一句），依相關實體的名稱排序；句中的實體不在清單中時 entityId 拿掉（不做連結）
  sentences: SentencePart[][];
}

export interface ListGroup {
  // 群組 id 與種類（clusters.ts）
  id: string;
  kind: ClusterKind;
  // 群組名稱：容器本身或群內關聯最多的實體（與節點標籤相同的消歧名稱）；「其他」用 client/i18n/ 的名稱
  label: string;
  // 標題前的圖示：代表實體的類型；「其他」為 null
  type: string | null;
  entities: ListEntity[];
}

// 清單列出的實體：類型篩選掉的不列；「只看它」時只列聚焦集合（與圖上沒有變灰的部分相同）
export function listedEntities(graph: Graph, excluded: ReadonlySet<string>, expansion: Expansion, isolated: boolean): ReadonlySet<string> {
  const focus = isolated ? focusOf(graph, expansion) : null;
  return new Set(graph.entities.filter((e) => !excluded.has(e.id) && (focus === null || focus.entities.has(e.id))).map((e) => e.id));
}

// 群組依分群的順序（實體數多的在前，「其他」最後）；群組內代表實體在最前，其他依名稱排序；沒有列出實體的群組不列。
// clustering 是篩選後的圖（類型篩選與「只顯示關聯 ≥ N」）的分群，所以篩選掉的實體不在任何群組
export function listGroups(graph: Graph, clustering: Clustering, listed: ReadonlySet<string>, excluded: ReadonlySet<string>, language: string): ListGroup[] {
  const collator = new Intl.Collator(language);
  const label = (e: GraphEntity) => entityOptionLabel(graph, e, language);
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const sentencesOf = (id: string): SentencePart[][] => {
    const others = new Map<string, GraphRelation[]>();
    for (const r of graph.relations) {
      if (r.from !== id && r.to !== id) continue;
      const other = r.from === id ? r.to : r.from;
      if (other === id || excluded.has(other) || !byId.has(other)) continue;
      others.set(other, [...(others.get(other) ?? []), r]);
    }
    return [...others.entries()]
      .sort(([a], [b]) => collator.compare(label(byId.get(a)!), label(byId.get(b)!)) || a.localeCompare(b))
      .flatMap(([, rs]) =>
        relationSentenceParts(
          graph,
          rs.sort((a, b) => a.id.localeCompare(b.id)),
          language,
        ),
      )
      .map((parts) => parts.map((p) => (p.entityId === undefined || listed.has(p.entityId) ? p : { text: p.text })));
  };
  return clustering.clusters.flatMap((cluster) => {
    const anchor = cluster.anchor === null ? undefined : byId.get(cluster.anchor);
    const entities = cluster.members
      .filter((id) => listed.has(id) && byId.has(id))
      .map((id) => byId.get(id)!)
      .map((entity) => ({
        entity,
        label: label(entity),
        sentences: sentencesOf(entity.id),
      }))
      .sort(
        (a, b) =>
          Number(b.entity.id === cluster.anchor) - Number(a.entity.id === cluster.anchor) ||
          collator.compare(a.label, b.label) ||
          a.entity.id.localeCompare(b.entity.id),
      );
    if (entities.length === 0) return [];
    return [
      {
        id: cluster.id,
        kind: cluster.kind,
        label: anchor === undefined ? strings(language).graphZoom.other : label(anchor),
        type: anchor?.type ?? null,
        entities,
      },
    ];
  });
}

// 清單中每一項的錨點（關係句的連結跳到這裡）
export const listAnchor = (entityId: string) => `graph-list-${entityId}`;

// 「圖譜｜清單」的選擇記在這個瀏覽器（docs/design.md）：只存這一個值，不存身分、邀請碼或資料。
// localStorage 在私密瀏覽或被封鎖時可能拋錯；失敗時用圖譜、不記住
export type GraphMode = "graph" | "list";
const KEY = "kk.graphMode";

export interface ModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserStorage = (): ModeStorage | null => (typeof localStorage === "undefined" ? null : localStorage);

export function loadGraphMode(storage = browserStorage()): GraphMode {
  try {
    return storage?.getItem(KEY) === "list" ? "list" : "graph";
  } catch {
    return "graph";
  }
}

export function saveGraphMode(mode: GraphMode, storage = browserStorage()): void {
  try {
    storage?.setItem(KEY, mode);
  } catch {
    // 不記住
  }
}
