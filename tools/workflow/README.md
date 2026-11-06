# workflow 工具

開發流程用的 Node 工具，無相依套件（`package.json` 只為了 `npm test`）。指令清單見 [AGENTS.md](../../AGENTS.md) 第 2 節；本文件是各工具的參數與說明。

## 測試

`npm test --prefix tools/workflow` 以 Node 內建的 `node --test` 執行本資料夾（含 `hooks/`、`runner/`）所有 `*.test.mjs`。CI 的 `checks` job 也會執行。

除了各工具的單元測試，還會檢查 repo 內的檔案：

| 測試 | 檢查 |
| --- | --- |
| `personal-paths.test.mjs` | 開發流程工具的檔案沒有 `/Users/<名稱>`、`/home/<名稱>` 形式的個人路徑（規則與 `scripts/check-sensitive.mjs` 共用） |

文件規則的其他檢查在專案的 `npm test`（Vitest）：Markdown 的 shell 指令區塊不加 `#` 註解是 `scripts/doc-commands.test.mjs`，repo 內的 email 與禁用名稱是 `npm run check:sensitive`（`scripts/check-sensitive.mjs`，見 [docs/testing.md](../../docs/testing.md)）。

## 各工具

| 檔案 | 用途 |
| --- | --- |
| `bootstrap-github.mjs` | 新 repo 的標籤與看板（本專案不適用，見 AGENTS.md 第 2 節） |
| `check-pr-body.mjs` | PR 描述要連到 Issue（CI） |
| `check-post-body.mjs` | agent 與決策中心貼出 PR 描述與留言前的檢查 |
| `read-trusted.mjs` | 讀取 Issue 與 PR，只輸出可信身分的內容 |
| `hooks/confirm-main.mjs` | 合併與 push 到 main 前的確認 hook（`.claude/settings.json` 的 `PreToolUse` 註冊） |
| `runner/` | 自動化模組的 agent runner，見 [runner/README.md](runner/README.md) |

email 與個人路徑的檢查是專案的 `scripts/check-sensitive.mjs`（`npm run check:sensitive`），不在本資料夾。

### bootstrap-github.mjs

```bash
node tools/workflow/bootstrap-github.mjs --repo <owner/name> [--modules core,online,collab,automation,goal] [--dry-run]
```

- 依 `.github/labels.yml` 建立已啟用模組的標籤，並複製、連結範本看板（憲法第 9 節 B 段）。
- `--modules` 預設只有 `core`。模組名稱對應 `docs/workflow/modules.md`：`core` 是核心、`online` 是上線、`collab` 是協作、`automation` 是自動化、`goal` 是目標模式。備援模組沒有標籤，不需要加。
- `--dry-run` 只列出將執行的 `gh` 指令；仍會讀取現有標籤與看板，不做任何寫入。
- 範本看板的 owner 與編號在 `config.json`。
- 本專案的標籤與看板已建立，不執行；測試仍包含在 `npm test --prefix tools/workflow`。

### check-pr-body.mjs

```bash
PR_BODY='Closes #1' PR_LABELS='[]' node tools/workflow/check-pr-body.mjs
```

- PR 描述要有 `Closes #N` 或 `Refs #N`（GitHub 的 close／fix／resolve 關鍵字也算）；帶 `fast-lane` 標籤的 PR 除外。
- HTML 註解與程式碼中的關鍵字不算。
- CI 的 `PR body` workflow（`.github/workflows/pr-body.yml`）在 PR 開啟、編輯、更新與標籤變更時執行；本文與標籤只經環境變數傳入。

### check-post-body.mjs

```bash
node tools/workflow/check-post-body.mjs --issue N --kind <種類> <檔案>
```

- 以 `gh … --body-file` 貼出 PR 描述或留言前執行，通過後以同一個檔案貼出。
- 種類與各自的要求見 `docs/workflow/agent-workflow.md`「貼出 PR 描述與留言」：`pr`、`plan`、`stop`、`fix`、`todo`，以及決策中心用的 `decision`、`change-request`（`docs/workflow/decision-center.md` 第 5 節）。
- 所有種類都檢查 email 與個人路徑（規則與 `scripts/check-sensitive.mjs` 共用），只輸出行號與種類；不比對禁用名稱。
- runner 執行時（有 `RUNNER_RUN_TMP`）另檢查檔案位置與修改時間不早於 `RUNNER_RUN_STARTED`，並且不接受標準輸入；手動執行時拒絕 30 分鐘以前修改的檔案。
- 通過時以 0 結束，不通過時以 1 結束。

### read-trusted.mjs

```bash
node tools/workflow/read-trusted.mjs --issue N
node tools/workflow/read-trusted.mjs --pr N
```

- 以 `gh api` 讀取 Issue 或 PR，只輸出可信身分的本文、留言、審查與 review comment；非可信身分的只輸出筆數。可信身分的定義見 `docs/workflow/agent-workflow.md` 第 0 步。
- Issue 或 PR 的作者不是可信身分時，不輸出標題與本文（`trusted: false`）。
- 規則與 runner 共用（`runner/lib.mjs` 的 `trustedOnly()`）。
