# 模組

核心每個專案都啟用；其他模組依各自的啟用時機（見各節標題與「自動化」的啟用條件）。啟用的模組記錄在 `AGENTS.md` 的專案設定。

## 如何啟用或停用

1. 開 Issue（`rfc`）說明原因。
2. 寫一份 ADR 記錄決定。
3. 以 PR 更新 `AGENTS.md` 的「啟用模組」，並加入該模組的檔案、標籤與規則。

template repo 本身的決定記在 rfc Issue，不寫 ADR：`docs/adr/` 會被複製到新專案，且 ADR 0001 保留給新專案的技術選型。從 template 建立的專案仍照上述步驟寫 ADR。（試驗中）

## 核心（每個專案）

| 類別 | 內容 |
| --- | --- |
| 文件 | RFC 0001 專案章程、輕量 ADR |
| 規則 | `AGENTS.md` 第 5 節硬規則、第 6 節先問人清單（含帳號登入、金鑰輸入、安裝系統軟體：由人處理，決策 agent 同樣不輸入帳號與金鑰） |
| 流程 | 一 Issue 一 PR、`Closes`／`Refs`、停止回報與 `## 決定`、修正模式、`plan-first`、快速通道 |
| 標籤 | `type:*`、`blocked`、`changes-requested`、`needs-human`、`rfc`、`plan-first`、`fast-lane`、`phase:*`、`area:*` |
| 防護 | 合併確認 hook、PR 描述檢查 CI |

## 協作（有第二個人，或他人使用的 agent）

| 類別 | 內容 |
| --- | --- |
| 規則 | 開工認領、分區與熱點檔案、新 Issue 需另一位負責人同意後才實作、RFC 給對方審、高風險 PR（類別見 `decision-center.md` 第 4 節）需要非作者核准、agent commit 加上 Co-Authored-By 標記 |
| 自動化工具 | 個人的自動化工具（例如 runner）不放進共用 repo，放在各自的本機、repo 之外；repo 只共用標籤與規則。要共用工具時先寫 ADR（試驗中） |
| 指標 | 只衡量流程（CI 首次通過率、停止次數等），不比較個人（試驗中） |
| 流程 | 同步會議：複製 `templates/modules/collab/sync.md` 到 `.github/ISSUE_TEMPLATE/` |
| 標籤 | `sync` |

## 上線（有正式環境或真實使用者）

| 類別 | 內容 |
| --- | --- |
| 規則 | 不碰正式資料庫與部署；合併後確認正式環境；一次合併一個；低流量時段合併 |
| 流程 | 合併前需外部設定的 PR 保持 Draft 並加 `needs-setup`；回退流程寫成文件；外部監控 |
| 標籤 | `needs-setup` |
| 防護 | CI：帶 `needs-setup` 的 PR 失敗 |

## 高風險（資料庫遷移、金流、權限、個資）

| 類別 | 內容 |
| --- | --- |
| 規則 | 每項技術選型寫 ADR；營運開關預設關閉；migration 不隨部署自動執行；不修改已套用的 migration |
| 流程 | 相關 Issue 一律 `plan-first`；高風險檔案優先細讀；CI 用真實資料庫服務測試 |
| 防護 | CI：比對已套用的 migration 是否被修改 |

## 自動化（本機 runner 依標籤接手 Issue，試驗中）

runner 依 GitHub 標籤接手工作、啟動 coding agent 執行 `/work-on-issue`，並在 GitHub 回報結果；觸發與合併仍由人決定。本節是自動化模組規則的正本；操作方式見 `tools/workflow/runner/README.md`。

| 類別 | 內容 |
| --- | --- |
| 啟用條件 | 全部滿足才啟用：CI 有實際檢查（不是佔位步驟）；手動執行 `/work-on-issue` 至少 3 次；停止流程（`blocked` → `## 決定`）與修正模式（`changes-requested`）各實測一次 |
| 標籤 | `agent:ready`：可以交給 agent，由人加，或決策 agent 經人確認後加。`agent:working`：runner 處理中，由 runner 加、由 runner 移除 |
| 規則 | runner 只負責觸發與記錄，不做判斷。接工作順序：自己 PR 上的 `changes-requested` → 已有 `## 決定`（只採信可信身分寫的）的 `blocked` → `agent:ready`（最舊的先做）。一次只做一件，在專用的 git worktree 從 `origin/main` 開始；開始時把 `agent:ready` 換成 `agent:working`，結束時移除 `agent:working`；claude 執行失敗或逾時時 runner 保存進度、自己留 `## agent 停止` 並加 `blocked`；runner 準備階段的錯誤只發本機通知，不在 GitHub 留言 |
| 看板 | 標籤是主要依據。runner 開始時設 In progress、結束時設 Review；決策 agent 開工時核對看板與實際狀況並修正（憲法第 5 節） |
| 防護 | 規則由本模組規定，數值由各專案設定：同時只跑一個（lock 檔）、`PAUSE` 檔緊急暫停；執行時段、單件時間上限，`agent:working` 長時間沒有 runner 時留言回報；sandbox 開啟，sandbox 不可用時不執行，網路只允許必要網域；禁止指令清單（合併或關閉 PR、關閉或刪除 Issue、repo／secret／release 操作、push main、強制推送、`git reset --hard`、`rm -rf`、`sudo`、`curl`、`wget`、DELETE API）；計費保護（環境中有 API key 時不執行，啟動後 `apiKeySource` 不是 `none` 就立即終止）；log 即時寫入，結尾記錄輪數、時間、token 用量 |
| runner 放置位置 | 個人專案（未啟用協作）：repo 的 `tools/workflow/runner/`，隨 template 複製、升級走 PR；個人設定（repo、帳號、worktree 路徑、看板編號）放不進版本控制的 `config.local.json`，log、lock、`PAUSE` 放不進版本控制的資料夾。多人協作（啟用協作）：放在各自的本機、repo 之外（見「協作」） |
| 轉「已驗證」 | 條件皆已完成（是否改為「已驗證」由人決定）：✅ 實測合併確認 hook 在 `claude -p`（無人值守）下回傳 `ask` 時的行為（等同拒絕），並寫進 runner 說明（#24）；✅ runner 在第二個專案實際跑過（#20） |
