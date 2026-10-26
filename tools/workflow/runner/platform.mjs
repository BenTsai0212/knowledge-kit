// 平台差異集中在這裡（本機通知）。目前只支援 macOS。
import { execFileSync } from 'node:child_process';

/** 本機通知：runner 自身的錯誤只寫紀錄並通知，不在 GitHub 留言。不支援的平台只寫紀錄；通知失敗不影響執行。 */
export function notify(message, platform = process.platform) {
  if (platform !== 'darwin') return;
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title "agent runner"`]);
  } catch {}
}
