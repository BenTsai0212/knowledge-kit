// 選定的客戶資料夾：環境變數 KK_CLIENT=<名稱> 對應 clients/<名稱>/，未設定或空字串時用參考情境 client/（#77）。
// vite.config.ts 的 @client 別名與 check-client.mjs 共用，規則只寫在這裡（docs/client-config.md「多客戶與切換」）。
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
// 參考情境；npm test（vitest.config.ts）固定用這裡（#77 決定 4）
export const REFERENCE_CLIENT_DIR = join(REPO_ROOT, "client");
const CLIENT_NAME = /^[a-z0-9][a-z0-9-]*$/;

// 回傳不含結尾斜線的絕對路徑；名稱不合法、資料夾或其中的 client.json 不存在時丟出錯誤
export function resolveClientDir(env = process.env, root = REPO_ROOT) {
  const name = env.KK_CLIENT ?? "";
  if (name === "") return join(root, "client");
  if (!CLIENT_NAME.test(name)) {
    throw new Error(`KK_CLIENT=${name}：名稱只能用小寫英文字母、數字與 -，且以字母或數字開頭`);
  }
  const dir = join(root, "clients", name);
  if (!existsSync(join(dir, "client.json"))) throw new Error(`KK_CLIENT=${name}：找不到 clients/${name}/client.json`);
  return dir;
}
