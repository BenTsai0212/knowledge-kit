---
description: 依 docs/workflow/agent-workflow.md 實作一張 GitHub Issue，並開出 PR
argument-hint: <issue 編號>
---

請實作 Issue #$ARGUMENTS。

嚴格依照 `docs/workflow/agent-workflow.md` 的步驟 0–9 進行，並遵守 `AGENTS.md` 的所有規則。
第 0 步會自動判斷：沒有連到此 Issue 的開啟中 PR 時開始新工作；已有帶 `changes-requested` 的 PR 時進入修正模式。
Issue 帶 `plan-first` 且尚無 `## 決定` 時，在第 2 步留言計畫並停止。
遇到停止條件時，依工作流程「停止時的回報」在 PR 或 Issue 留言並加上 `blocked`，再向我回覆一句摘要與留言連結。
