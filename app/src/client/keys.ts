// 每個物件型別的鍵清單，供 schema-sync.test.ts 與 JSON Schema 比對。
// satisfies KeyManifest<T>：型別多一個或少一個鍵、必填與否標錯時，npm run typecheck 會失敗。
import type {
  AliasRules,
  AccessFile,
  ClientFile,
  ConflictsFile,
  EntityTypeFile,
  KnowledgeModelFile,
  PathRef,
  Project,
  Question,
  RelationType,
  RetrievalFile,
  UploadFile,
  Role,
  Scenario,
  ScenariosFile,
  ThemeColors,
  ThemeFile,
  ThemeFonts,
  VisibilityLevel,
} from "./types";

export type KeyManifest<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? "optional" : "required";
};

export interface ManifestEntry {
  schema: string;
  // Schema 中該物件的 JSON Pointer
  pointer: string;
  keys: Record<string, "required" | "optional">;
}

const pathRef = { path: "required" } satisfies KeyManifest<PathRef>;
const localizedLabel = { id: "required", label: "required" } satisfies KeyManifest<Project>;

export const manifests: ManifestEntry[] = [
  {
    schema: "client.schema.json",
    pointer: "",
    keys: {
      displayName: "required",
      defaultLanguage: "required",
      languages: "required",
      model: "required",
      dataset: "required",
      evals: "required",
      retrieval: "optional",
      upload: "optional",
      conflicts: "optional",
    } satisfies KeyManifest<ClientFile>,
  },
  { schema: "client.schema.json", pointer: "/properties/dataset", keys: pathRef },
  { schema: "client.schema.json", pointer: "/properties/evals", keys: pathRef },
  {
    schema: "client.schema.json",
    pointer: "/properties/retrieval",
    keys: { provider: "optional", topK: "optional", minScore: "optional" } satisfies KeyManifest<RetrievalFile>,
  },
  {
    schema: "client.schema.json",
    pointer: "/properties/upload",
    keys: { passageMaxChars: "optional", extractMaxBatches: "optional" } satisfies KeyManifest<UploadFile>,
  },
  {
    schema: "client.schema.json",
    pointer: "/properties/conflicts",
    keys: { enabled: "optional", candidatesPerPassage: "optional", minScore: "optional" } satisfies KeyManifest<ConflictsFile>,
  },
  {
    schema: "theme.schema.json",
    pointer: "",
    keys: { colors: "required", fonts: "required" } satisfies KeyManifest<ThemeFile>,
  },
  {
    schema: "theme.schema.json",
    pointer: "/properties/colors",
    keys: {
      primary: "required",
      onPrimary: "required",
      background: "required",
      surface: "required",
      text: "required",
      textMuted: "required",
      border: "required",
    } satisfies KeyManifest<ThemeColors>,
  },
  {
    schema: "theme.schema.json",
    pointer: "/properties/fonts",
    keys: { body: "required", heading: "required" } satisfies KeyManifest<ThemeFonts>,
  },
  {
    schema: "knowledge-model.schema.json",
    pointer: "",
    keys: { entityTypes: "required", relationTypes: "required" } satisfies KeyManifest<KnowledgeModelFile>,
  },
  {
    schema: "knowledge-model.schema.json",
    pointer: "/properties/entityTypes/items",
    keys: {
      id: "required",
      label: "required",
      color: "required",
      aliasRules: "required",
      mergeStrategy: "optional",
    } satisfies KeyManifest<EntityTypeFile>,
  },
  {
    schema: "knowledge-model.schema.json",
    pointer: "/properties/entityTypes/items/properties/aliasRules",
    keys: {
      ignoreCase: "required",
      normalizeWidth: "required",
      ignoreWhitespace: "required",
    } satisfies KeyManifest<AliasRules>,
  },
  {
    schema: "knowledge-model.schema.json",
    pointer: "/properties/relationTypes/items",
    keys: { id: "required", label: "required", from: "required", to: "required" } satisfies KeyManifest<RelationType>,
  },
  {
    schema: "access.schema.json",
    pointer: "",
    keys: { visibilityLevels: "required", projects: "required", roles: "required" } satisfies KeyManifest<AccessFile>,
  },
  {
    schema: "access.schema.json",
    pointer: "/properties/visibilityLevels/items",
    keys: { id: "required", label: "required", rank: "required", color: "required" } satisfies KeyManifest<VisibilityLevel>,
  },
  { schema: "access.schema.json", pointer: "/properties/projects/items", keys: localizedLabel },
  {
    schema: "access.schema.json",
    pointer: "/properties/roles/items",
    keys: { id: "required", label: "required", visibility: "required", projects: "required", canUpload: "required", canReview: "required" } satisfies KeyManifest<Role>,
  },
  {
    schema: "scenarios.schema.json",
    pointer: "",
    keys: { scenarios: "required" } satisfies KeyManifest<ScenariosFile>,
  },
  {
    schema: "scenarios.schema.json",
    pointer: "/properties/scenarios/items",
    keys: {
      id: "required",
      title: "required",
      description: "optional",
      role: "required",
      questions: "required",
    } satisfies KeyManifest<Scenario>,
  },
  {
    schema: "scenarios.schema.json",
    pointer: "/properties/scenarios/items/properties/questions/items",
    keys: { id: "required", text: "required", answerPassages: "required" } satisfies KeyManifest<Question>,
  },
];
