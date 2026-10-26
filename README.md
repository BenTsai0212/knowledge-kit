# dev-workflow-template

個人開發 workflow 的 template：**Claude Project 做決策、coding agent 做實作、GitHub 記錄一切。**
新專案從這裡建立；新專案初始化時會改寫本 README。

- 版本：v0.7（試驗中，私人）
- 原則與分工：[憲法](docs/workflow/constitution.md)
- Claude Project 的操作手冊：[decision-center](docs/workflow/decision-center.md)
- coding agent 的規則：[AGENTS.md](AGENTS.md)、[agent-workflow](docs/workflow/agent-workflow.md)

## 開新專案

1. 建立 repo 並 clone：`gh repo create <owner>/<name> --private --template <template repo> --clone`。
2. 在新 repo 建立標籤與看板：`node tools/workflow/bootstrap-github.mjs --repo <owner/name> --modules <群組>`（可先加 `--dry-run`；`--modules` 只能填 `.github/labels.yml` 裡有的群組）。
3. 合併後自動刪分支：`gh repo edit <owner/name> --delete-branch-on-merge`。
4. 開啟新看板的 auto-add：`https://github.com/users/<owner>/projects/<N>/workflows`。
5. 決定是否刪除 GitHub 自動產生的預設標籤（不刪也不影響流程）。
6. 建立 Claude Project：貼上 `templates/claude-project/instructions.md`，連結本機資料夾，把 `templates/claude-project/handoff.md` 放進知識庫。
7. 在 Claude Project 說「依 decision-center 初始化」。

完整步驟見憲法第 9 節。

## 內容

| 路徑 | 內容 |
| --- | --- |
| `docs/workflow/` | 憲法、決策中心手冊、模組、agent 工作流程、GitHub 操作清單 |
| `docs/rfcs/`、`docs/adr/` | 專案章程與決策紀錄（索引為空，新專案自行填寫） |
| `AGENTS.md`、`CLAUDE.md` | coding agent 的規則（`CLAUDE.md` 只引用 `AGENTS.md`） |
| `.claude/commands/` | `/work-on-issue`、`/pm-apply` |
| `.github/` | Issue／PR 範本、標籤定義、CI 佔位 |
| `templates/` | Claude Project 指示與交接範本、預設不啟用的模組檔案 |

## 修改 template

依憲法第 10 節：開 Issue（`rfc`）→ PR → 合併 → 版本號加一。
