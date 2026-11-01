// 端對端測試讀取的客戶資料（#77）：KK_CLIENT 選定的客戶資料夾（未設定時是參考情境 client/），在 Node 端以 fs 讀取。
// 測試中不寫死角色、等級或專案；需要的身分由 access.json 推算，前提不成立時由各測試以 test.skip 略過並寫明原因。
import { readFileSync } from "node:fs";
import type { AccessFile, ClientFile, KnowledgeModelFile, Role, ScenariosFile, ThemeFile, UiStrings } from "../../app/src/client/types";
import { resolveClientDir } from "../../scripts/client-dir.mjs";

// Playwright 在 repo 根目錄執行；build 時用同一個 KK_CLIENT（docs/testing.md）
export const clientDir = resolveClientDir(process.env);
export const clientName = process.env.KK_CLIENT ?? "";
export const readClientJson = <T>(path: string): T => JSON.parse(readFileSync(`${clientDir}/${path}`, "utf8")) as T;

export const client = readClientJson<ClientFile>("client.json");
export const access = readClientJson<AccessFile>("access.json");
export const scenarios = readClientJson<ScenariosFile>("scenarios.json");
export const theme = readClientJson<ThemeFile>("theme.json");
export const knowledgeModel = readClientJson<KnowledgeModelFile>("knowledge-model.json");

// 介面文字只用預設語言；鍵的型別以參考情境的翻譯檔為準（check:client 檢查各語言的鍵相同）
export const language = client.defaultLanguage;
export const s = readClientJson<typeof import("@client/i18n/zh-TW.json")>(`i18n/${language}.json`);

const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
// 可見等級 rank 最高的一個；同分時取 access.json 中較前面的
const highest = (roles: Role[]): Role | undefined =>
  roles.reduce<Role | undefined>((best, r) => (best === undefined || rank.get(r.visibility)! > rank.get(best.visibility)! ? r : best), undefined);

// 能審查的身分中看得最多的（參考情境是 manager）
export const reviewer = highest(access.roles.filter((r) => r.canReview));
// 不能審查的身分中看得最多的（參考情境是 staff）
export const nonReviewer = highest(access.roles.filter((r) => !r.canReview));
// 能上傳的身分中看得最多的（參考情境是 manager）
export const uploader = highest(access.roles.filter((r) => r.canUpload));
// 能上傳也能審查的身分中看得最多的（參考情境是 manager）
export const reviewingUploader = highest(access.roles.filter((r) => r.canUpload && r.canReview));

export const NO_REVIEWER = "access.json 沒有 canReview 的身分";
export const NO_NON_REVIEWER = "access.json 沒有不能審查（canReview: false）的身分";
export const NO_UPLOADER = "access.json 沒有 canUpload 的身分";
export const NO_REVIEWING_UPLOADER = "access.json 沒有同時 canUpload 與 canReview 的身分";
