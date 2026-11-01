---
description: 依 docs/playbook/new-client-setup.md，從新客戶 Issue 建立 clients/<名稱>/ 的 demo
argument-hint: <issue 編號>
---

請依新客戶 Issue #$ARGUMENTS 建立 demo。

1. 讀 Issue #$ARGUMENTS（需求摘要、資料盤點、客戶名稱、語言、品牌色是否可用）與 `docs/playbook/new-client-setup.md`。
2. 嚴格依照 `docs/workflow/agent-workflow.md` 的步驟與 `AGENTS.md` 的規則進行；實作內容依 `new-client-setup.md` 的第 1～8 步，每一步的「驗收」通過才進下一步。
3. 遇到 ⏸ 檢查點時，依工作流程「停止時的回報」在 Issue 留言（`## agent 停止`，內容依該檢查點的要求）並加上 `blocked`，再向我回覆一句摘要與留言連結。之後依 `## 決定` 繼續。
4. 只修改 `clients/<名稱>/`。需要修改其他程式或 Schema 時，停下來回報。
