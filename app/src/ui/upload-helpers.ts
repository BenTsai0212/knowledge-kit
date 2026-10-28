// 上傳頁的輔助計算（#42）：誰看得到、今天的日期、檔案大小。
import type { AccessFile, Role } from "../client/types";

// 依 access.json 算出看得到這個可見等級與專案的角色（與 docs/data-model.md 的讀取規則相同；
// 實際權限由 RLS 執行，這裡只是給上傳者參考，app/tests/upload/audience.test.ts 與 oracle 比對）
export function audienceRoles(access: AccessFile, level: string, project: string | null): Role[] {
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  return access.roles.filter(
    (role) => rank.get(level)! <= rank.get(role.visibility)! && (project === null || role.projects.includes(project)),
  );
}

// 本地時區的今天，YYYY-MM-DD（不用 toISOString：那是 UTC，台灣早上 8 點前會差一天）
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
