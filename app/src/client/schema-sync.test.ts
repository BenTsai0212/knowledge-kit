import { describe, expect, it } from "vitest";
import accessSchema from "../../../client/schema/access.schema.json";
import clientSchema from "../../../client/schema/client.schema.json";
import knowledgeModelSchema from "../../../client/schema/knowledge-model.schema.json";
import scenariosSchema from "../../../client/schema/scenarios.schema.json";
import themeSchema from "../../../client/schema/theme.schema.json";
import documentSchema from "../../../client/schema/data/document.schema.json";
import entitiesSchema from "../../../client/schema/data/entities.schema.json";
import relationsSchema from "../../../client/schema/data/relations.schema.json";
import { datasetManifests } from "../dataset/keys";
import { manifests as clientManifests } from "./keys";

const manifests = [...clientManifests, ...datasetManifests];

interface ObjectSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

const schemas: Record<string, unknown> = {
  "client.schema.json": clientSchema,
  "theme.schema.json": themeSchema,
  "knowledge-model.schema.json": knowledgeModelSchema,
  "access.schema.json": accessSchema,
  "scenarios.schema.json": scenariosSchema,
  "data/document.schema.json": documentSchema,
  "data/entities.schema.json": entitiesSchema,
  "data/relations.schema.json": relationsSchema,
};

function resolve(schema: unknown, pointer: string): ObjectSchema {
  return pointer
    .split("/")
    .slice(1)
    .reduce<any>((node, key) => node?.[key], schema);
}

// Schema 中所有帶 properties 的物件（definitions 內只放純量定義，略過）
function objectPointers(node: unknown, pointer = ""): string[] {
  if (typeof node !== "object" || node === null) return [];
  const own = "properties" in node ? [pointer] : [];
  return [
    ...own,
    ...Object.entries(node)
      .filter(([key]) => key !== "definitions")
      .flatMap(([key, child]) => objectPointers(child, `${pointer}/${key}`)),
  ];
}

describe("TS 型別與 JSON Schema 一致", () => {
  it.each(manifests.map((m) => [`${m.schema}#${m.pointer || "/"}`, m] as const))("%s", (_name, m) => {
    const node = resolve(schemas[m.schema], m.pointer);
    expect(node?.properties, "Schema 中找不到此物件").toBeDefined();
    expect(Object.keys(m.keys).sort()).toEqual(Object.keys(node.properties!).sort());
    const required = Object.entries(m.keys)
      .filter(([, v]) => v === "required")
      .map(([k]) => k)
      .sort();
    expect(required).toEqual([...(node.required ?? [])].sort());
  });

  it("Schema 中每個物件都有對應的鍵清單", () => {
    const covered = new Set(manifests.map((m) => `${m.schema}#${m.pointer}`));
    const missing = Object.entries(schemas).flatMap(([name, schema]) =>
      objectPointers(schema)
        .map((p) => `${name}#${p}`)
        .filter((key) => !covered.has(key)),
    );
    expect(missing).toEqual([]);
  });
});
