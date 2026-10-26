// 讀取 runner 設定檔與解析路徑（agent-runner.mjs 與 usage-report.mjs 共用）。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = join(RUNNER_DIR, 'config.local.json');
export const BASE_SETTINGS_FILE = join(RUNNER_DIR, 'runner-settings.base.json');
export const GENERATED_SETTINGS_FILE = join(RUNNER_DIR, '.generated', 'runner-settings.json');
export const PROJECT_PAUSE = join(RUNNER_DIR, 'PAUSE');
export const GLOBAL_DIR = join(homedir(), '.agent-runner');
export const GLOBAL_LOCK = join(GLOBAL_DIR, 'lock');
export const GLOBAL_PAUSE = join(GLOBAL_DIR, 'PAUSE');

/** runner 所在 repo 的根目錄（使用者平常的資料夾，runner 只讀取、不切換分支）。 */
export function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: RUNNER_DIR, encoding: 'utf8' }).trim();
}

/** 讀取設定檔；不存在時回傳 null，JSON 錯誤時丟出例外。 */
export function readConfig(file = CONFIG_FILE) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 設定中的相對路徑一律相對於 repo 根目錄。 */
export function resolvePaths(config, root) {
  return {
    worktree: resolve(root, config.worktree ?? ''),
    logDir: resolve(root, config.logDir ?? 'tools/workflow/runner/logs'),
  };
}
