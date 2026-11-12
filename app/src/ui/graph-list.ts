// 圖譜的清單模式（#289，docs/design.md「圖譜的鍵盤操作與螢幕報讀器」的「容器與清單模式」）：以文字列出同一份可見圖，
// 群組 → 實體 → 關係句。純函式，只用 readGraph() 回傳的可見圖（#247）：實體、關係與句中的名稱都只涉及目前身分看得到的部分。
// 群組先用實體類型（#289 決定 1）；#254 之後換成它的分群（容器類型／社群偵測），清單的元件與關係句的連結沿用。
import { clientConfig } from "../client/load";
import { focusOf, type Expansion } from "../graph/expansion";
import type { Graph, GraphEntity, GraphRelation } from "../graph/read";
import { relationSentenceParts, type SentencePart } from "./graph-keyboard";
import { entityOptionLabel, entityTypeLabel } from "./graph-labels";

const { entityTypes } = clientConfig.knowledgeModel;

export interface ListEntity {
  entity: GraphEntity;
  label: string;
  // 每個相關實體一句或兩句（兩個方向各一句），依相關實體的名稱排序；句中的實體不在清單中時 entityId 拿掉（不做連結）
  sentences: SentencePart[][];
}

export interface ListGroup {
  type: string;
  label: string;
  entities: ListEntity[];
}

// 清單列出的實體：類型篩選掉的不列；「只看它」時只列聚焦集合（與圖上沒有變灰的部分相同）
export function listedEntities(graph: Graph, excluded: ReadonlySet<string>, expansion: Expansion, isolated: boolean): ReadonlySet<string> {
  const focus = isolated ? focusOf(graph, expansion) : null;
  return new Set(graph.entities.filter((e) => !excluded.has(e.id) && (focus === null || focus.entities.has(e.id))).map((e) => e.id));
}

// 群組依 knowledge-model.json 的類型順序，其他類型排在後面（依類型 id）；群組內依名稱排序；沒有實體的群組不列
export function listGroups(graph: Graph, listed: ReadonlySet<string>, excluded: ReadonlySet<string>, language: string): ListGroup[] {
  const collator = new Intl.Collator(language);
  const label = (e: GraphEntity) => entityOptionLabel(graph, e, language);
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const order = (type: string) => {
    const i = entityTypes.findIndex((t) => t.id === type);
    return i < 0 ? entityTypes.length : i;
  };
  const types = [...new Set(graph.entities.filter((e) => listed.has(e.id)).map((e) => e.type))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
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
  return types.map((type) => ({
    type,
    label: entityTypeLabel(type, language),
    entities: graph.entities
      .filter((e) => e.type === type && listed.has(e.id))
      .map((entity) => ({
        entity,
        label: label(entity),
        sentences: sentencesOf(entity.id),
      }))
      .sort((a, b) => collator.compare(a.label, b.label) || a.entity.id.localeCompare(b.entity.id)),
  }));
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
