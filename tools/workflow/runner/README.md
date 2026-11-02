# agent runner（自動化模組，試驗中）

本機的 runner 依 GitHub 標籤接手工作，啟動 coding agent（`claude -p "/work-on-issue N"`）實作，並在 GitHub 回報結果。觸發（`agent:ready`）與合併仍由人決定。規則見憲法第 6 節「自動化 runner」與 `docs/workflow/modules.md`「自動化」。

只在**已啟用自動化模組**的個人專案使用；啟用條件見 modules.md。多人協作的專案不把 runner 放進共用 repo。

## 會處理的工作（依優先順序，一次一件，可連續處理）

1. 修正模式：自己帳號開的 PR 帶 `changes-requested`（PR 也帶 `blocked` 時，須已有 `## 決定`）
2. 依決定繼續：帶 `blocked`、在最後一次 `## agent 停止` 或 `## 計畫` 之後已有 `## 決定` 的 Issue 或自己的 PR。`## 決定` 只採信 repo 的 OWNER、MEMBER、COLLABORATOR 寫的留言（GitHub 的 `authorAssociation`）；其他人寫的忽略，避免公開 repo 中任何人都能觸發無人值守的執行
3. 新工作：帶 `agent:ready` 的 Issue（沒有 `agent:working`／`blocked`），最舊的先做

- PR 一律換成描述中 `Closes`／`Refs` 的 Issue；`agent:working` 只加在 Issue 上。描述找不到 Issue 的 PR 不接。
- 新工作只在「自己開的、開啟中、非 Draft 的 PR」少於 `maxOpenPrs` 時才接；修正模式與依決定繼續不受此限制。
- 開始時把 `agent:ready` 換成 `agent:working`、看板設為 In progress；結束時移除 `agent:working`，沒有 `blocked` 時看板設為 Review。
- claude 非正常結束（逾時、非 0 結束、計費保護終止、啟動失敗）：先保存進度（見下方「中斷時保存進度」），再由 runner 自己留 `## agent 停止` 並加 `blocked`。
- runner 自身的錯誤（fetch、建立或清理 worktree、worktree 有未提交的變更、標籤操作失敗等）：只寫紀錄檔並發本機通知，**不在 GitHub 留言、不改標籤**，並停止本次的連續處理。GitHub 上的 `## agent 停止` 只用於需要人決定的問題，避免讓剛寫好的 `## 決定` 失效。
- `agent:working` 超過 `staleHours` 沒有更新、且沒有 runner 在跑：視為中斷，留言並加 `blocked`。

### 連續處理

做完一件後，以下條件都符合時立刻接下一件（每一輪重新查詢 GitHub 挑選）：

- 仍在執行時段內、沒有 `PAUSE`（專案與全機兩層）、未過最晚開始時間（`lastStart`）；
- 本次喚醒處理的件數少於 `maxPerRun`（預設 5）；
- 上一件的 claude 正常結束（包含 agent 自行停止並加上 `blocked`）；claude 非正常結束或 runner 自身錯誤時，停止本次的連續處理；
- 佇列還有工作。同一次喚醒不重複處理同一件。

連續處理期間一直持有全機 lock。`--now` 只處理一件，且不受執行時段與最晚開始時間限制。

**最晚開始時間**：過了 `lastStart` 不開始新工作，已在進行的會做完。未設定時為執行時段結束減去 `timeoutMinutes`（例如 `[9, 18]`、45 分鐘 → 17:15）。

**時間上限只算醒著的時間**：每 30 秒累計一次；兩次間隔超過 2 分鐘視為筆電休眠，該段只算 30 秒，並在紀錄檔記下休眠時間。

### 中斷時保存進度

claude 非正常結束後，若 runner 的 worktree 有未提交的修改或未推送的 commit：

1. 建立 `wip/<Issue>-<YYYYMMDD-HHmm>` 分支並 commit（`--no-verify`、`commit.gpgsign=false`），推送到 origin，worktree 回到 `origin/main`。推送失敗時分支保留在 runner 的 worktree（本機）。
2. 只有 commit 本身失敗時，才用 `git stash push -u -m "runner-wip <Issue> <時間>"`。stash 與主資料夾共用同一個堆疊；runner 不會 pop。
3. 停止回報寫明分支名稱與是否已推送（或 stash 訊息）。

不推到 agent 原本的分支（可能已開 PR），也不刪除任何東西。接手時從 `wip/` 分支取回需要的修改；用完的 `wip/` 分支由人刪除。

## 設定

```bash
cp tools/workflow/runner/config.example.json tools/workflow/runner/config.local.json
```

`config.local.json` 不進版本控制。設定檔不存在或有問題時，runner 列出所有問題並結束，不執行。

| 欄位 | 必要 | 說明 |
| --- | --- | --- |
| `repo` | ✓ | `owner/name` |
| `account` | ✓ | 你的 GitHub 帳號：修正模式只處理這個帳號開的 PR；停止回報 @ 這個帳號 |
| `worktree` | ✓ | runner 專用資料夾（git worktree），相對路徑以 repo 根目錄為準，例如 `../name-runner` |
| `hours` | ✓ | 執行時段 `[開始, 結束)`，本機時間的小時，例如 `[9, 18]` |
| `timeoutMinutes` | ✓ | 單件時間上限（分鐘，只算醒著的時間） |
| `staleHours` | ✓ | `agent:working` 超過幾小時沒有更新視為中斷 |
| `maxOpenPrs` | ✓ | 待審 PR 上限（只限制新工作） |
| `lastStart` |  | 最晚開始時間 `[時, 分]`，例如 `[17, 0]`；不能晚於執行時段結束。省略時為執行時段結束減去 `timeoutMinutes` |
| `maxPerRun` |  | 一次喚醒最多處理幾件（1 以上的整數），預設 5 |
| `board` |  | 看板 `{ "owner": 帳號, "number": 編號 }`；`null` 或省略時不更新看板 |
| `env` |  | 傳給 agent 的額外環境變數（例如測試資料庫的連線字串）；不能包含 `ANTHROPIC_API_KEY`／`ANTHROPIC_AUTH_TOKEN` |
| `agentNotes` |  | 給 agent 的補充說明（字串陣列），接在 runner 的共用說明之後 |
| `skipBranchPrefixes` |  | 不處理的分支前綴，例如其他 agent 的 `codex/` |
| `extraAllow` |  | 專案額外允許的指令，例如 `"Bash(docker compose *)"` |
| `extraAllowedDomains` |  | sandbox 額外允許的網域 |
| `sandboxExcludedCommands` |  | 不在 sandbox 內執行的指令（例如 `docker compose *`） |
| `logDir` |  | log 資料夾，預設 `tools/workflow/runner/logs` |

### 權限設定

`runner-settings.base.json` 是共用的允許與禁止清單（含 sandbox 設定），不放任何專案路徑。每次執行時，runner 加入 sandbox 可寫入的 `<repo>/.git`（worktree 的 git 資料在主 repo 內）與上表的 `extra*` 欄位，寫成 `.generated/runner-settings.json`（不進版本控制），以 `--settings` 傳給 agent。

禁止清單包含：合併或關閉 PR、`gh pr checkout`、關閉或刪除 Issue、`gh repo`／`gh secret`／`gh release`、`gh api` 中任何含 `merge` 的呼叫（REST 與 GraphQL）與 DELETE、推到 main 的各種寫法（`main`、`+main`、`<ref>:main`、`:main`、`refs/heads/main`）、`--delete`／`-d`、`--force`／`-f`、`--mirror`／`--all`、`git reset --hard`、`rm -rf`、`sudo`、`curl`、`wget`。

修正模式不需要 `git reset --hard`：agent 使用 runner 專屬的本地分支 `runner/<分支>`，以 `git push origin HEAD:<分支>` 推送；runner 每次開始前清除舊的 `runner/*` 本地分支。

## 指令

| 指令 | 用途 |
| --- | --- |
| `node tools/workflow/runner/agent-runner.mjs --dry-run` | 試跑：只顯示會挑哪一件，不改 GitHub、不動 worktree |
| `node tools/workflow/runner/agent-runner.mjs --now` | 手動執行一件（不受執行時段與最晚開始時間限制） |
| `node tools/workflow/runner/agent-runner.mjs` | 排程用：只在執行時段內執行，可連續處理 |
| `node tools/workflow/runner/usage-report.mjs [--since 2026-10-13]` | 使用量報表 |

紀錄在 `logs/`：`<時間>.log` 是 runner 的紀錄，`<時間>-claude-<Issue>.log` 是 agent 的即時輸出（stream-json）。

## 暫停（兩層）

| 範圍 | 暫停 | 恢復 |
| --- | --- | --- |
| 只有這個專案 | `touch tools/workflow/runner/PAUSE` | 刪除該檔 |
| 整台電腦（所有使用本程式的 runner） | `mkdir -p ~/.agent-runner && touch ~/.agent-runner/PAUSE` | 刪除該檔 |

`~/.agent-runner/lock` 讓整台電腦同一時間只跑一個 runner（記錄 pid 與 repo；pid 不存在時視為過期並清除，試跑只記錄不清除）。全機 lock 與 `PAUSE` 是試驗中的設計。

**舊版 runner 不受全機 lock 與 `PAUSE` 管控**：同一台電腦上若有其他專案仍在使用舊版 runner（放在 repo 之外、各自有 lock 的版本），兩者可能同時執行。改用本程式前，先停掉舊版的排程，或確認兩者的執行時段不重疊。

## 排程（launchd，由人親自安裝與移除）

repo 內的範本是 `agent-runner.plist.example`。安裝前替換檔內的四個欄位：`__ACCOUNT__`（GitHub 帳號）、`__REPO__`（repo 名稱）、`__REPO_DIR__`（repo 絕對路徑）、`__PATH__`（`which node claude gh git` 結果所在的資料夾，以 `:` 分隔）。排程名稱 `com.<帳號>.agent-runner.<repo>` 包含 repo 名稱，同一台電腦有多個專案時不會撞名。

1. 確認 `which` 列出的資料夾都在 `__PATH__` 裡，再複製範本：

   ```bash
   cd <repo 絕對路徑>
   which node claude gh git
   PLIST=~/Library/LaunchAgents/com.<帳號>.agent-runner.<repo>.plist
   cp tools/workflow/runner/agent-runner.plist.example "$PLIST"
   ```

2. 用編輯器替換 `$PLIST` 中的 `__ACCOUNT__`、`__REPO__`、`__REPO_DIR__`、`__PATH__`。
3. 檢查並載入排程；最後一行立刻跑一次（不在執行時段會直接結束）：

   ```bash
   plutil -lint "$PLIST"
   mkdir -p tools/workflow/runner/logs
   launchctl bootstrap gui/$(id -u) "$PLIST"
   launchctl kickstart gui/$(id -u)/com.<帳號>.agent-runner.<repo>
   ```

**移除**：`launchctl bootout gui/$(id -u)/com.<帳號>.agent-runner.<repo>`，再刪除 `~/Library/LaunchAgents/` 中的 plist。

電腦睡眠時不會執行，醒來後補跑一次。排程本身的錯誤看 `logs/launchd.err.log`。

### 本機通知

runner 自身的錯誤（準備階段失敗、無法在 GitHub 留言、runner 本身失敗）會跳 macOS 通知，內容是錯誤的第一行，詳細內容在 `logs/`。通知等平台相關的部分集中在 `platform.mjs`；其他平台只寫紀錄、不通知。

## macOS sandbox 的已知問題與處理

| 問題 | 處理 |
| --- | --- |
| sandbox 內 `gh` 讀不到鑰匙圈 | runner 先以 `gh auth token` 取得 token，以 `GH_TOKEN` 傳給 agent（不寫進 log 或檔案） |
| sandbox 內無法查詢系統憑證 | 傳入 `SSL_CERT_FILE=/etc/ssl/cert.pem` |
| sandbox 不允許寫入主 repo 的 `.git/config` | 以環境變數設定 `branch.autoSetupMerge=false`；說明中要求 agent 不用 `push -u`、`--set-upstream-to`、`gh pr checkout` |
| main 被主資料夾佔用 | worktree 以 detached HEAD 從 `origin/main` 開始；agent 直接從 `origin/main` 開分支 |
| sandbox 不可用 | `failIfUnavailable: true`，不執行 |
| 需要 sandbox 外的工具（例如 docker） | 加進 `sandboxExcludedCommands` 與 `extraAllow`；worktree 與主資料夾若使用同一個 port，兩者不能同時開著 |

## 已知限制

- 禁止清單是指令字首的萬用字元比對，不是完整的防護：
  - `gh api` 的其他寫入（例如以 PATCH 關閉 PR 或 Issue、修改 repo 設定）沒有被擋下；
  - `node *` 是允許的，agent 可以在 Node 程式中執行其他指令。
  - 實際防線是 sandbox（檔案寫入與網路限制）、人的審查，以及合併由人決定。
- 合併確認 hook（`.claude/settings.json`）在 `claude -p` 無人值守下回傳 `ask` 時，**等同拒絕**：指令不會執行（`permission_denied`，原因為 hook），agent 收到 hook 的訊息作為錯誤結果後繼續工作，session 不會卡住等待確認（2026-10-13 實測，#24）。
  - 因此 hook 無法判斷目標分支的推送（例如先 `cd` 再 `git push`、`--git-dir`）在 runner 下一律被拒絕。給 agent 的共用說明已要求推送時直接寫明分支（`git push origin HEAD:<分支>`），不要先 `cd` 再推送。
  - 確定推到 main 的指令本來就在禁止清單中，不受影響。
- 只支援 macOS（launchd、通知、sandbox）。

## 成本參考

- runner 使用 Claude Code 的訂閱登入執行，不另外收 API 費用；用量計入訂閱額度。
- 計費保護：環境中有 `ANTHROPIC_API_KEY`／`ANTHROPIC_AUTH_TOKEN` 時不執行；`claude` 啟動後回報的 `apiKeySource` 不是 `none` 時立即終止並留言。
- `usage-report.mjs` 列出每次執行的輪數、時間、token 與「API 等值」（依 API 公開價格換算的參考值，只代表用量大小）。訂閱額度的實際剩餘量，以 Claude Code 的 `/usage` 或 claude.ai 設定頁為準。
