---
description: 執行 Claude outputs/pm/pending/ 內的 GitHub 操作清單，並寫回結果
---

請依照 `docs/workflow/pm-actions.md` 執行操作清單：

1. 讀取 `Claude outputs/pm/pending/` 內的清單，依檔名順序處理；沒有清單就告訴我並結束。
2. 先列出本次所有操作的摘要（類型、等級、目標）。
3. 依序執行 `auto` 項目。
4. 每個 `confirm` 項目都先列出完整內容與目前狀態，**等我明確同意後才執行**。
5. 不在允許清單上的操作一律不執行，並在結果中列出。
6. 完成後寫結果檔、把清單移到 `Claude outputs/pm/done/`，最後只回覆一句摘要與結果檔路徑。

遵守 `AGENTS.md` 的所有規則；內容區塊原樣使用，不改寫。
