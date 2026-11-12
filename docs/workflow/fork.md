# fork 後要改的地方

開發流程工具（`tools/workflow/`、`.claude/`、`docs/workflow/`）不寫死個人的帳號或路徑。fork 本 repo 後，依下列清單改成自己的設定。

## 必改

- `AGENTS.md` 第 0 節：Repo（`owner/name`）、看板（GitHub Project 編號與網址）、決定者（停止回報與 `plan-first` 時 @ 的帳號）。
- `LICENSE`：MIT 要求保留原著作權聲明；另加一行自己的著作權聲明，不刪除原本的。
- `README.md`、`README.zh-TW.md`、`SECURITY.md`、`.github/ISSUE_TEMPLATE/access-code-request.md`：線上 demo 的網址、@ 的帳號與回報方式。
- 登入頁的帳號登入只是展示（#287）：換成客戶的身分驗證，要改的地方見 `docs/client-config.md`「登入（展示）」。

## 新的組織

- `clients/<名稱>/i18n/` 的每種語言都要有 `demoAccessCodeHint`、`demoQaNotice`、`demoUploadNotice` 三個鍵（只在線上 demo 顯示，見 `docs/qa.md`「線上 demo」）；`global_daily_limit` 的文字提到「線上試用」「本機執行」，依情境修改。步驟見 `docs/playbook/new-client-setup.md`。

## 啟用自動化模組（runner）時

說明見 `tools/workflow/runner/README.md`。

- 把 `tools/workflow/runner/config.example.json` 複製成 `config.local.json`（不進版本控制），填入 `repo`、`account`、`worktree`、`board`、`hours`。
- runner 停止回報時 @ 的是 `account`；與 `AGENTS.md` 的決定者不同時，兩邊都要確認。
- 排程：替換 `agent-runner.plist.example` 的 `__ACCOUNT__`、`__REPO__`、`__REPO_DIR__`、`__PATH__` 四個欄位，由人安裝。

## 用 bootstrap 建立新 repo 時

- `tools/workflow/config.json` 的 `templateBoard`：範本看板的 `owner` 與 `number`。`number` 是 `null` 時，`bootstrap-github.mjs` 略過看板步驟並列入待辦。不用 bootstrap 時不必改。

## 敏感資料與 secret

- repo secret `SENSITIVE_NAMES` 與本機的 `.sensitive-names.local`（禁用名稱清單；見 `docs/testing.md`）。沒有設定 secret 時，CI 的 `Sensitive data` workflow 會失敗。
- Worker 的 `.dev.vars`：從 `.dev.vars.example` 複製，金鑰自己填（見 `worker/README.md`）。

## GitHub 設定

- 標籤：依 `.github/labels.yml` 建立（`bootstrap-github.mjs` 或手動）。
- 看板：開啟 auto-add（Workflows 設定，複製看板時不會帶過來）。
- repo 設定：開啟合併後自動刪除分支（Settings → General → Automatically delete head branches）。
- Actions 的外部貢獻者核准：fork 不會帶過來，Settings → Actions → General →「Approval for running fork pull request workflows from contributors」選「Require approval for all external contributors」。沒有這項設定時，公開 repo 收到外部 PR 會直接執行 workflow。
- main 的分支保護：fork 不會帶過來，自行建立 ruleset（Settings → Rules → Rulesets）：需要 PR、必要檢查（`checks`、`clients`、`sensitive-names`、`gitleaks`、`pr-body`）、禁止強制推送與刪除。E2E 在 PR 與 push 到 main 時執行，不要列為必要檢查（ADR 0010）。

## 檢查

`npm test --prefix tools/workflow` 的 `personal-paths.test.mjs` 會檢查上述目錄中沒有 `/Users/<名稱>`、`/home/<名稱>` 形式的個人路徑。
