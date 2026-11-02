# ADR 0003：啟用自動化模組（本機 runner）

- 狀態：Accepted（2026-10-29）
- 決定者：@BenTsai0212
- 相關：`docs/workflow/modules.md`「自動化」、`tools/workflow/runner/README.md`

## 背景

開發流程是「決策中心寫 Issue／決定 → 人在本機執行 `/work-on-issue` → 審查 → 人授權合併」。人不在電腦前時，流程停在「執行 `/work-on-issue`」這一步。

## 決定

啟用自動化模組，使用 template 內建的 `tools/workflow/runner/`，以 launchd 排程在作者的 Mac 上執行。

**觸發**：
- `agent:ready`：由人加，或決策中心經人確認後加。
- `changes-requested`（修正模式）、`blocked` 加上可信身分寫的 `## 決定`（依決定繼續）：沿用現有規則。
- 合併一律由人授權，runner 與 agent 都不合併。

**設定**（`config.local.json`，不進版本控制；變更時更新本 ADR）：

| 欄位 | 值 | 理由 |
| --- | --- | --- |
| `hours` | `[9, 18]`（Mac 本機時間） | 出問題時人通常醒著 |
| `timeoutMinutes` | `45` | 目前單一 PR 多在 15～30 分鐘內完成 |
| `lastStart` | 省略（＝17:15） | 執行時段結束前留足時間 |
| `staleHours` | `2` | template 預設 |
| `maxOpenPrs` | **`1`** | 本專案同時只能有 1 個 PR 在審查 |
| `maxPerRun` | `5` | template 預設 |
| `board` | `{ "owner": "BenTsai0212", "number": 9 }` | 自動更新看板狀態 |
| `worktree` | `../knowledge-kit-runner` | runner 專用資料夾 |
| `skipBranchPrefixes` | `["codex/"]` | template 預設 |
| `env`、`extra*` | 空 | 不需要額外的工具或網域 |

**防護**：沿用 runner 的設計。sandbox（不可用時不執行）、禁止指令清單、全機 lock、`PAUSE` 緊急暫停、單件時間上限、計費保護（只用 Claude Code 訂閱；環境中有 API key 時不執行）。

## 後果

- Mac 必須開機、連網、沒有睡眠，runner 才會執行；睡眠時不執行，醒來後補跑。要長時間遠端作業時，由人自行設定 Mac 在接電源時不自動睡眠。
- 需要在本機瀏覽器操作的人工驗收（真實金鑰、畫面確認）仍由人在電腦前執行。
- 禁止清單不是完整的防線（見 runner README「已知限制」）。實際防線是 sandbox、決策中心的審查，以及由人授權合併。
- 用量計入 Claude Code 訂閱額度；以 `usage-report.mjs` 追蹤。
