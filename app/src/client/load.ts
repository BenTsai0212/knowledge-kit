// 在 build 時讀入 client/*.json。驗證由 npm run check:client（ajv）在 CI 執行，不打包進前端。
import access from "../../../client/access.json";
import client from "../../../client/client.json";
import knowledgeModel from "../../../client/knowledge-model.json";
import scenarios from "../../../client/scenarios.json";
import theme from "../../../client/theme.json";
import type { ClientConfig, ClientFiles, ConflictsConfig, RetrievalConfig, UploadConfig } from "./types";

// JSON import 的字串型別會放寬成 string，列舉值無法在編譯時比對；
// 這裡比對其餘的形狀（缺欄位、型別不符時 typecheck 失敗），列舉值由 ajv 檢查。
export type Widen<T> = T extends string
  ? string
  : T extends (infer U)[]
    ? Widen<U>[]
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

const files: Widen<ClientFiles> = { client, theme, knowledgeModel, access, scenarios };

// 與 client.schema.json 的 default 相同（load.test.ts 比對）
export const RETRIEVAL_DEFAULTS: RetrievalConfig = { provider: "keyword-hash", topK: 5, minScore: 0.1 };
export const UPLOAD_DEFAULTS: UploadConfig = { passageMaxChars: 300, extractMaxBatches: 3 };
export const CONFLICTS_DEFAULTS: ConflictsConfig = { enabled: false, candidatesPerPassage: 3, minScore: 0.15 };

export function normalizeClient(raw: ClientFiles): ClientConfig {
  return {
    ...raw,
    client: {
      ...raw.client,
      retrieval: { ...RETRIEVAL_DEFAULTS, ...raw.client.retrieval },
      upload: { ...UPLOAD_DEFAULTS, ...raw.client.upload },
      conflicts: { ...CONFLICTS_DEFAULTS, ...raw.client.conflicts },
    },
    knowledgeModel: {
      ...raw.knowledgeModel,
      entityTypes: raw.knowledgeModel.entityTypes.map((t) => ({ ...t, mergeStrategy: t.mergeStrategy ?? "review" })),
    },
  };
}

export const clientConfig: ClientConfig = normalizeClient(files as ClientFiles);
