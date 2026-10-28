// client/data/ 的型別。JSON Schema（client/schema/data/）是唯一正本；改 Schema 時同步修改本檔與 keys.ts。
import type { Id, LanguageCode, LocalizedText } from "../client/types";

export type IsoDate = string;

export interface DatasetPassage {
  id: Id;
  text: string;
  language?: LanguageCode;
  visibility?: Id;
  project?: Id;
}

export interface DatasetDocument {
  id: Id;
  title: string;
  language: LanguageCode;
  date?: IsoDate;
  visibility: Id;
  project?: Id;
  passages: DatasetPassage[];
}

export interface DatasetEntity {
  id: Id;
  type: Id;
  // 主要名稱，萃取與合併時使用
  name: string;
  // 各介面語言的顯示名稱
  names: LocalizedText;
  aliases?: string[];
  sources: Id[];
}

export interface DatasetRelation {
  id: Id;
  type: Id;
  from: Id;
  to: Id;
  sources: Id[];
}

export interface EntitiesFile {
  entities: DatasetEntity[];
}

export interface RelationsFile {
  relations: DatasetRelation[];
}
