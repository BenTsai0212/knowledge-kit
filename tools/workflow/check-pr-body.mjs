#!/usr/bin/env node
// PR 描述檢查：本文要連到 Issue（Closes／Refs #N），帶 fast-lane 的 PR 除外。
// 憲法第 6 節「程式化防護」、第 7 節「快速通道」。
// 用法：PR_BODY=<本文> PR_LABELS=<JSON 陣列或逗號分隔> node tools/workflow/check-pr-body.mjs
import { fileURLToPath } from 'node:url';

// 與 docs/workflow/agent-workflow.md 第 0 節的正規表示式一致（#N 換成任意數字）
const ISSUE_LINK = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?|refs)\s*:?\s+#\d+\b/i;
const FAST_LANE = 'fast-lane';

export function parseLabels(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // 不是 JSON 時視為逗號分隔
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// 回傳 { ok, message }
export function checkPrBody(body, labels) {
  if (labels.includes(FAST_LANE)) {
    return { ok: true, message: `帶 ${FAST_LANE} 標籤，不檢查 Issue 連結。` };
  }
  // PR 範本的 HTML 註解、程式碼區塊與行內程式碼不算內容（GitHub 也不會在程式碼中連結 Issue）
  const text = (body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
  if (ISSUE_LINK.test(text)) {
    return { ok: true, message: 'PR 描述已連到 Issue。' };
  }
  return {
    ok: false,
    message: 'PR 描述沒有連到 Issue：請寫 `Closes #N` 或 `Refs #N`（N 為 Issue 編號），快速通道的 PR 則加上 fast-lane 標籤。',
  };
}

function main() {
  const result = checkPrBody(process.env.PR_BODY ?? '', parseLabels(process.env.PR_LABELS));
  if (result.ok) {
    console.log(result.message);
  } else {
    console.log(`::error::${result.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
