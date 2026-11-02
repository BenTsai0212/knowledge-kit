# RFC 0002：公開與授權

- 狀態：Accepted（2026-11-01；待決問題 1、2 於實際公開前決定）
- 日期：2026-11-01
- 決定者：@BenTsai0212
- 相關：RFC 0001（第 2 階段「公開準備」）、Epic #3（第 1 階段完成）

## 摘要

knowledge-kit 以 **MIT 授權**公開。第 2 階段先把「可以公開」的條件做完：授權檔、git 歷史中的個人 email、內容與歷史的稽核、公開用的說明文件。**實際設為公開的時間另行決定**，預計在第一個多語言客戶驗證之後。開發流程工具（`tools/workflow/`、runner、`.claude/` 指令、`docs/workflow/`）與 demo 套件一起公開。

## 問題與使用者

- RFC 0001 規定：先自己用，驗證後整理成公開版本，授權與公開時程另開 RFC 決定。第 1 階段已完成，門檻 1～5 實測通過（#88）。
- 公開的對象是想為客戶快速做出「第二大腦」demo 的開發者，以及想參考「交給 coding agent 照文件做」這套做法的人。
- 越晚處理 git 歷史，受影響的 fork 越多；所以「可以公開」的條件現在就做，公開與否之後再決定。

## 提案

### 1. 授權：MIT

- 新增 `LICENSE`（MIT），著作權人為 `BenTsai0212`，年份 2026。
- `README.md`、`package.json` 的 `license` 欄位一併標示。
- 理由：最寬鬆、最常見，使用者可以自由使用、修改與商用，只需保留版權聲明；符合「擴大影響力」的目標。不防止他人拿去做商業服務，這點接受。

### 2. git 歷史中的個人 email

現況（2026-11-01 檢查）：

- `Initial commit` 與所有在 GitHub 上合併的 squash commit（目前 61 個），作者 email 都是帳號的主要個人 email；agent 推送的 commit 已使用 GitHub noreply。
- 原因：在 GitHub 上合併 PR 時，作者使用帳號的主要 email。

處理：

1. **立即**：在 GitHub 帳號設定開啟「Keep my email addresses private」（與「Block command line pushes that expose my email」），之後網頁與 API 的合併改用 noreply。由人在 GitHub 設定中操作。
2. **改寫歷史**：以 `git filter-repo` 的 mailmap 把個人 email 換成 noreply，全部分支一起改寫後強制推送。屬於高風險操作，由人執行；執行前先做完整的鏡像備份（`git clone --mirror`），並清空 runner 的 worktree。
3. **已知限制**：GitHub 會保留每個 PR 的 `refs/pull/<編號>/head`，改寫後舊 commit 仍可從 PR 取得，個人 email 也就仍可見。所以公開方式要二選一（見「待決問題」1）。

### 3. 內容與歷史的稽核

公開前確認目前的檔案與整段 git 歷史都沒有：

- 真實客戶名稱、合作夥伴品牌名稱：以 `SENSITIVE_NAMES` 清單掃描**整段歷史**（目前 CI 只掃描檔案），由人在本機執行，清單不進 repo。
- 金鑰：gitleaks 已掃過整段歷史（#66），公開前再跑一次。
- 個人路徑與帳號資訊：例如 `/Users/<名稱>`、本機資料夾名稱、個人 email。
- 設計語言：確認介面使用的設計語言可以公開（若參考了合作夥伴的設計，取得同意）。
- 若公開現有 repo（待決問題 1 的 A），Issue 與 PR 的文字也要稽核：決策紀錄中不得有客戶與夥伴名稱。

### 4. 公開用的說明文件

- `README.md`：改寫成對外說明，中英各一份（`README.md` 英文為主、`README.zh-TW.md`）：
  - 這是什麼：第二大腦 demo 的 template，demo 是展示用原型，不是正式系統
  - 快速開始：安裝、以參考情境啟動、建立第一個客戶（連到 playbook）
  - 資料安全：demo 的資料全部在瀏覽器，權限是「展示用權限」（連到資料安全說明）
  - 開發流程：怎麼交給 coding agent（連到 `docs/workflow/`）
- `SECURITY.md`：回報安全問題的方式。
- 流程工具：檢查 `tools/workflow/`、`.claude/`、`docs/workflow/` 中的帳號、路徑與個人化設定，改成可替換的設定或範例值。
- 不新增：`CONTRIBUTING.md`、行為準則；公開後有外部參與時再補。

## 不做什麼

- 本 RFC 不把 repo 設為公開。實際公開由人另以 `## 決定` 決定（預計在第一個多語言客戶驗證之後）。
- 不處理多語言（泰文、跨語言檢索）：等第一個多語言客戶確認後再開始，屆時先以 plan-first 評估語意向量的做法（瀏覽器內模型與外部 API）。
- 不接受外部貢獻流程、不建立社群管道。
- 不改授權以外的商業安排。

## 階段與門檻

第 2 階段「公開準備」部分的門檻：

1. `LICENSE`（MIT）與公開用 `README.md`、`README.zh-TW.md`、`SECURITY.md` 已合併
2. 新的 commit 不再出現個人 email；依待決問題 1 的決定，處理完歷史中的個人 email
3. 稽核通過：整段歷史的敏感名稱掃描與 gitleaks 都是 0；流程工具中沒有個人路徑與帳號資訊
4. 設計語言可公開使用（已確認）
5. CI 通過

多語言部分的門檻在客戶確認後另訂。

## 待決問題

1. **公開方式**（因為 PR 的 ref 會保留舊 commit）：
   - **A. 公開現有 repo**：保留所有 Issue 與 PR，完整呈現決策過程；但舊 commit 中的個人 email 仍可從 PR 的 ref 看到，要請 GitHub Support 清除快取的 ref（不保證）或接受曝光。Issue 與 PR 的文字也要稽核。
   - **B. 另開公開 repo**：把改寫後的歷史推到新的公開 repo，現有 repo 保持私人，繼續當開發用；個人 email 不會出現。代價是公開版看不到 Issue 與 PR 的決策紀錄，之後要定期把私人 repo 同步到公開 repo。
2. `README.md` 以英文為主、另附繁中，還是反過來（playbook 目前是繁中為主、`en/` 為英文）。

