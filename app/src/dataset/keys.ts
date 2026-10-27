// 資料集各物件型別的鍵清單，供 app/src/client/schema-sync.test.ts 與 JSON Schema 比對（作法見 app/src/client/keys.ts）。
import type { KeyManifest, ManifestEntry } from "../client/keys";
import type { DatasetDocument, DatasetEntity, DatasetPassage, DatasetRelation, EntitiesFile, RelationsFile } from "./types";

export const datasetManifests: ManifestEntry[] = [
  {
    schema: "data/document.schema.json",
    pointer: "",
    keys: {
      id: "required",
      title: "required",
      language: "required",
      date: "optional",
      visibility: "required",
      project: "optional",
      passages: "required",
    } satisfies KeyManifest<DatasetDocument>,
  },
  {
    schema: "data/document.schema.json",
    pointer: "/properties/passages/items",
    keys: {
      id: "required",
      text: "required",
      language: "optional",
      visibility: "optional",
      project: "optional",
    } satisfies KeyManifest<DatasetPassage>,
  },
  {
    schema: "data/entities.schema.json",
    pointer: "",
    keys: { entities: "required" } satisfies KeyManifest<EntitiesFile>,
  },
  {
    schema: "data/entities.schema.json",
    pointer: "/properties/entities/items",
    keys: {
      id: "required",
      type: "required",
      name: "required",
      aliases: "optional",
      sources: "required",
    } satisfies KeyManifest<DatasetEntity>,
  },
  {
    schema: "data/relations.schema.json",
    pointer: "",
    keys: { relations: "required" } satisfies KeyManifest<RelationsFile>,
  },
  {
    schema: "data/relations.schema.json",
    pointer: "/properties/relations/items",
    keys: { id: "required", type: "required", from: "required", to: "required", sources: "required" } satisfies KeyManifest<DatasetRelation>,
  },
];
