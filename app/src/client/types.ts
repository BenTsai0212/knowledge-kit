// client/*.json 的型別。JSON Schema（client/schema/）是唯一正本；改 Schema 時同步修改本檔與 keys.ts。

export type LanguageCode = string;
export type LocalizedText = Record<LanguageCode, string>;
export type Id = string;
export type ModelCode = string;
export type RelativePath = string;

// 檔案中的原始形狀

export interface PathRef {
  path: RelativePath;
}

export interface ClientFile {
  displayName: LocalizedText;
  defaultLanguage: LanguageCode;
  languages: LanguageCode[];
  model: ModelCode;
  dataset: PathRef;
  evals: PathRef;
}

export interface ThemeColors {
  primary: string;
  onPrimary: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
}

export interface ThemeFonts {
  body: string;
  heading: string;
}

export interface ThemeFile {
  colors: ThemeColors;
  fonts: ThemeFonts;
}

export interface AliasRules {
  ignoreCase: boolean;
  normalizeWidth: boolean;
  ignoreWhitespace: boolean;
}

export type MergeStrategy = "review" | "auto";

export interface EntityTypeFile {
  id: Id;
  label: LocalizedText;
  aliasRules: AliasRules;
  mergeStrategy?: MergeStrategy;
}

export interface RelationType {
  id: Id;
  label: LocalizedText;
  from: Id[];
  to: Id[];
}

export interface KnowledgeModelFile {
  entityTypes: EntityTypeFile[];
  relationTypes: RelationType[];
}

export interface VisibilityLevel {
  id: Id;
  label: LocalizedText;
  rank: number;
}

export interface Project {
  id: Id;
  label: LocalizedText;
}

export interface Role {
  id: Id;
  label: LocalizedText;
  visibility: Id;
  projects: Id[];
}

export interface AccessFile {
  visibilityLevels: VisibilityLevel[];
  projects: Project[];
  roles: Role[];
}

export interface Question {
  id: Id;
  text: LocalizedText;
}

export interface Scenario {
  id: Id;
  title: LocalizedText;
  description?: LocalizedText;
  role: Id;
  questions: Question[];
}

export interface ScenariosFile {
  scenarios: Scenario[];
}

export interface ClientFiles {
  client: ClientFile;
  theme: ThemeFile;
  knowledgeModel: KnowledgeModelFile;
  access: AccessFile;
  scenarios: ScenariosFile;
}

// app 讀取端拿到的形狀：省略的欄位已補上預設值

export interface EntityType extends Omit<EntityTypeFile, "mergeStrategy"> {
  mergeStrategy: MergeStrategy;
}

export interface ClientConfig extends Omit<ClientFiles, "knowledgeModel"> {
  knowledgeModel: {
    entityTypes: EntityType[];
    relationTypes: RelationType[];
  };
}
