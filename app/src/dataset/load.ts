// 在 build 時讀入選定客戶的 data/（@client 別名）。Schema 由 npm run check:client（ajv）在 CI 檢查；跨檔規則由 validate.ts 檢查。
import entities from "@client/data/entities.json";
import relations from "@client/data/relations.json";
import type { Widen } from "../client/load";
import type { DatasetDocument, EntitiesFile, RelationsFile } from "./types";

// import.meta.glob 的路徑必須是 @client/ 開頭的字面值，所以 app 只支援 client.json 的 dataset.path 為 data/
export const DATASET_ROOT = "data/";

export interface Dataset {
  root: string;
  // 相對於 root 的路徑 → 文件
  documents: Record<string, DatasetDocument>;
  entities: EntitiesFile;
  relations: RelationsFile;
}

const documentFiles = import.meta.glob<DatasetDocument>("@client/data/documents/*.json", {
  eager: true,
  import: "default",
});

// 實體與關係以 JSON import 讀入，形狀不符時 typecheck 失敗；文件經由 glob 讀入，形狀由 ajv 檢查
const checked: { entities: Widen<EntitiesFile>; relations: Widen<RelationsFile> } = { entities, relations };

export const dataset: Dataset = {
  root: DATASET_ROOT,
  documents: Object.fromEntries(
    Object.entries(documentFiles).map(([path, doc]) => [path.slice(path.lastIndexOf("/documents/") + 1), doc]),
  ),
  entities: checked.entities as EntitiesFile,
  relations: checked.relations as RelationsFile,
};
