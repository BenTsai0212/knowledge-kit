# GitHub 操作清單（PM actions）

本文件有兩個用途：

- **操作分類**：決策 agent（Claude Project）經 GitHub MCP 直接執行時，依下方「三級對照表」決定確認方式（憲法第 5 節）。
- **備援清單**：決策 agent 無法直接執行時（MCP 不能用，或 MCP 沒有對應工具，例如建立 Milestone、複製看板），把操作寫成一份**操作清單**，交給 Claude Code 的 `/pm-apply` 依序執行並寫回結果。

目的：人只需做決定與確認，不必手動搬運指令。

## 檔案位置

| 用途 | 位置 |
| --- | --- |
| 待執行 | `Claude outputs/pm/pending/YYYYMMDD-HHMM-<主題>.md` |
| 已處理（清單＋結果） | `Claude outputs/pm/done/` |

`Claude outputs/` 不進版本控制。

## 清單格式

````markdown
# PM 操作清單：<主題>

- 建立：YYYY-MM-DD HH:MM（註明時區）
- 來源：<決策對話或 Issue 連結>
- repo：<AGENTS.md 第 0 節的 Repo>

## 1. <簡短說明>

- 類型：issue.comment
- 等級：auto
- 目標：#37
- 原因：<為什麼要做，一句話>

```text
<要貼上的內容，原樣使用>
```
````

每一項都包含：類型、等級、目標、原因，以及需要時的內容區塊。目標可以寫編號或查詢條件，執行者需先解析成唯一的編號；解析不出唯一結果時不執行並回報。

可選欄位「依賴：#N」：N 是**同一份清單**的項目編號（不是 Issue 編號），表示只在項目 N 為「✅ 完成」時才執行。

## 操作類型與等級

### 三級對照表（決策 agent 經 MCP 寫入時，試驗中）

| 等級 | 決策 agent 的確認方式 | 操作類型 | `/pm-apply` 等級 |
| --- | --- | --- | --- |
| ① 先做後列 | 直接執行，在同一輪回覆列出做了什麼與連結 | `issue.comment`／`pr.comment`（一般留言：進度說明、測試結果）、`project.add`、`project.field`、`issue.parent`、`issue.assign`、`issue.labels`／`pr.labels`（分類標籤（`type:*`、`phase:*`、`area:*`）的加入與移除） | `auto` |
| ② 整批同意 | 在對話列出內容（可整批），人同意後執行 | `issue.create`、`issue.body-append`（修改 Issue 內容）、修正要求（`pr.comment`＋`changes-requested`）、`issue.labels`／`pr.labels`（流程標籤（`blocked`、`changes-requested`、`plan-first`、`needs-human`、`agent:ready`、`agent:working`、`fast-lane`）的加入與移除（移除 `plan-first` 除外））、`milestone.create` | `auto` |
| ③ 逐項確認 | 逐項列出完整內容，人明確同意後才執行 | `## 決定` 留言、`issue.labels`（移除 `plan-first`）、`pr.merge`、`issue.close`／`issue.reopen`、`label.create`、所有刪除、`pr.approve`、`pr.draft`／`pr.ready` | `confirm`（`## 決定` 留言與移除 `plan-first` 除外，見下） |

- **依內容升級**：任何寫入的內容碰到憲法第 5 節「人親自決定的範圍」，一律升為 ③。
- ① 的留言不得以 `## 決定` 開頭，也不得包含修正要求的核取方塊（避免 agent 誤讀為指示）。
- `## 決定` 先在對話討論選項，經人核准內容後才送出。寫進 `/pm-apply` 清單時類型仍是 `issue.comment`／`pr.comment`（`auto`），因為內容已在對話逐項核准；移除 `plan-first` 同理，在清單中仍是 `issue.labels`（`auto`）。
- 流程標籤會直接改變 agent 或 runner 的行為，因此不歸 ①。
- `/pm-apply` 的執行規則不變：下方 `auto`／`confirm` 兩表照舊；① ② 對應 `auto`，③ 對應 `confirm`。

### auto：可整批確認（`/pm-apply` 直接執行）

| 類型 | 說明 | 需要的欄位 |
| --- | --- | --- |
| `issue.create` | 建立 Issue | 標題、內容；可選標籤、Milestone、上層 Epic、加入看板 |
| `issue.comment` | 在 Issue 留言 | 目標、內容 |
| `issue.labels` | 新增／移除標籤 | 目標、新增、移除 |
| `issue.assign` | 指派負責人 | 目標、負責人 |
| `issue.body-append` | 在 Issue 本文最後附加內容 | 目標、內容 |
| `issue.parent` | 掛到上層 Epic | 目標、上層編號 |
| `pr.comment` | 在 PR 留言 | 目標、內容 |
| `pr.labels` | 在 PR 新增／移除標籤 | 目標、新增、移除 |
| `project.add` | 加入看板（AGENTS.md 第 0 節） | 目標 |
| `project.field` | 更新看板欄位（Status、Phase、Area、Priority、Size、Start／Target date） | 目標、欄位、值 |
| `milestone.create` | 建立 Milestone | 標題、描述、截止日 |

### confirm：執行前列出內容，等人確認

| 類型 | 說明 |
| --- | --- |
| `pr.approve` | approve **他人**開的 PR；PR 作者與執行帳號相同時不執行，改以 `pr.comment` 記錄（執行規則第 8 條） |
| `pr.merge` | 先更新分支、等 CI 通過，再 squash merge 並刪除分支；決策 agent 經 MCP 合併時不刪分支，由人刪除（或 repo 開啟自動刪除） |
| `pr.draft` / `pr.ready` | 切換 Draft 狀態 |
| `issue.close` / `issue.reopen` | 關閉或重新開啟 Issue |
| `label.create` | 建立新標籤（新標籤也要加進 `.github/labels.yml`） |

### 審查修正的標準寫法

1. `pr.comment`：以核取方塊（`- [ ]`）逐項列出修正要求。
2. `pr.labels`：新增 `changes-requested`，**依賴第 1 項**。

agent 之後以 `/work-on-issue <Issue 編號>` 進入修正模式。超出原 Issue 範圍的新需求改用 `issue.create` 另開 Issue。

### 回覆 agent 停止回報或 `plan-first` 計畫的標準寫法

- `pr.comment` 或 `issue.comment`（與停止回報或計畫同一處）：內容以 `## 決定` 開頭，逐項回應選項或計畫。

不必另外移除 `blocked`：agent 重新開始時讀到 `## 決定` 會自行移除。

### 不放進清單（一律由人親自處理）

repo、分支、檔案的刪除（標籤、看板項目、檢視的刪除依憲法第 5 節規則 3）、修改 repo 或分支保護設定、Secret 與環境變數、正式環境與資料庫操作、force push、修改他人分支的程式碼。

## 執行規則

1. 依檔名順序處理 `pending/` 內的清單；沒有清單時直接回報。
2. 先檢查每一項的類型是否在上表；不在表上的項目**不執行**，在結果中列出。
3. 內容區塊**原樣使用**，不改寫、不補充。
4. **看板欄位**：`issue.create` 有「加入看板」時，依標籤設定欄位：`phase:N` → Phase、`area:X` → Area，Status 預設 `Backlog`；清單另有指定時以清單為準。沒有對應標籤的欄位留空，並在結果的「需要人處理」列出。欄位與選項依名稱查詢 ID，不寫死。
5. **避免重複**：`issue.create` 前先搜尋同標題的開啟中 Issue，已存在就不建立並記錄其編號；留言前確認最近留言沒有相同內容。
6. `auto` 依序執行；`confirm` 逐項列出完整內容（目標、動作、目前狀態，例如 CI 結果），得到人明確同意後才執行。
7. 單一項目失敗不影響其他項目；失敗原因寫入結果。被依賴的項目不是「✅ 完成」時，依賴它的項目不執行、`confirm` 也不請求同意，標示「⏭ 因依賴未完成而略過」。
8. **`pr.approve` 先比對帳號**：PR 作者與 `gh` 登入帳號（`gh api user`）相同時，不執行 approve、不請求同意，改以 `pr.comment` 留下同一段內容，標示「↪ 改以留言記錄」。
9. 完成後寫結果檔，並把清單移到 `done/`。

## 結果檔格式

`Claude outputs/pm/done/<清單檔名去掉 .md>.result.md`：

```markdown
# 執行結果：<主題>

- 執行時間：YYYY-MM-DD HH:MM
- 執行者：Claude Code（/pm-apply）

| # | 類型 | 目標 | 結果 | 連結／說明 |
| --- | --- | --- | --- | --- |
| 1 | issue.comment | #37 | ✅ 完成 | <留言網址> |
| 2 | pr.merge | #45 | ⏸ 未確認 | 使用者暫不合併 |
| 3 | issue.create | — | ⚠️ 已存在 | 同標題 Issue #50，未重複建立 |
| 4 | pr.approve | #51 | ↪ 改以留言記錄 | PR 作者即執行帳號 |
| 5 | pr.merge | #51 | ⏭ 因依賴未完成而略過 | 依賴 #4 |

## 需要人處理
- …
```
