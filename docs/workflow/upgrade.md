# 升級 template：已建立的專案

從 template 建立的專案，在 template 更新後以 PR 升級（[憲法第 8 節](constitution.md#8-多專案管理)）。本文件是升級的程序：決策中心依此寫升級 Issue，coding agent 依此實作，人負責文中標明的人工步驟。

〔來源：一個專案從 v0.8 升級到 v0.14，拆成 5 個 PR、改了 32 個檔案，過程中整理出的做法（試驗中）｜可刪條件：template 改為以套件或子模組發佈，升級不再需要逐檔比對時〕

文中的佔位：`<template>` 是 template repo（`owner/name`），`<base>` 是專案建立時（或上次升級到）的 template commit，`<head>` 是這次要升到的 template commit。

## 1. 找出建立時的版本

以「Use this template」建立的專案，第一個 commit 的檔案內容與 template 當時的某個 commit 相同。用 blob SHA（git 對檔案內容的雜湊）比對，不用日期或 commit 訊息猜。

1. 專案第一個 commit 的檔案清單：

   ```bash
   git ls-tree -r "$(git rev-list --max-parents=0 HEAD)" --format='%(objectname) %(path)'
   ```

2. template 的候選 commit（建立專案前後的 commit）的檔案清單：

   ```bash
   gh api 'repos/<template>/commits?until=<專案建立日>T23:59:59Z&per_page=20' --jq '.[] | "\(.sha) \(.commit.message | split("\n")[0])"'
   gh api 'repos/<template>/git/trees/<候選 commit>?recursive=1' --jq '.tree[] | select(.type == "blob") | "\(.sha) \(.path)"'
   ```

3. 兩邊都有的路徑中，blob SHA 全部相同的候選就是 `<base>`。沒有完全相同的（例如建立時立刻改了檔案），取相同檔案最多的，並在升級 Issue 中註明差異的檔案。

已升級過的專案不需要這一步，見[第 7 節](#7-增量升級)。

## 2. 三份比對與檔案分類

對 `<base>`（template 的舊版）、`<head>`（template 的新版）、專案現況（`HEAD`）三份的 blob SHA 逐檔比對：

```bash
gh api 'repos/<template>/git/trees/<base>?recursive=1' --jq '.tree[] | select(.type == "blob") | "\(.sha) \(.path)"' > "$TMPDIR/upgrade-base.txt"
gh api 'repos/<template>/git/trees/<head>?recursive=1' --jq '.tree[] | select(.type == "blob") | "\(.sha) \(.path)"' > "$TMPDIR/upgrade-head.txt"
git ls-tree -r HEAD --format='%(objectname) %(path)' > "$TMPDIR/upgrade-project.txt"
```

`<base>` 與 `<head>` 相同的檔案（template 沒改）不用處理。其餘分成三類：

| 類別 | 判斷 | 處理 |
| --- | --- | --- |
| A：共用、專案沒改過 | 專案的 blob 與 `<base>` 相同 | 換成 `<head>` 的版本 |
| B：共用、專案改過 | 專案的 blob 與 `<base>`、`<head>` 都不同 | 以 `<head>` 為底，重新套用專案相對於 `<base>` 的修改（`<base>` → 專案的差異） |
| C：專案先做、template 後來吸收 | B 的差異中，專案的修改與 template 後來的修改是同一件事 | 保留較完整的一份，另一份多出的部分補進去 |

另外：

- `<head>` 新增、專案沒有的檔案：新增。專案已有同名檔案時依 B／C 處理。
- `<head>` 刪除、專案沒改過的檔案：刪除；專案改過的先在升級 Issue 中列出，由人決定。
- 只有專案有的檔案（專案自己的程式與文件）：不動。
- 專案與 `<head>` 已相同的檔案：不用處理。

分類結果（每類的檔案清單）寫進升級 Issue 或第一個 PR 的描述，審查時對照。

## 3. 讀取 template 的方式

- 只以 `gh api` 讀取 template 的檔案，不 `git fetch` template、不把 template 加成 remote、不合併 template 的歷史：

  ```bash
  gh api -H 'Accept: application/vnd.github.raw' 'repos/<template>/contents/<路徑>?ref=<head>'
  ```

- 每個 PR 推送前確認分支上只有這次的 commit，沒有混入 template 的 commit：

  ```bash
  git log origin/main..HEAD --format='%an %ae'
  ```

  只應出現專案的作者；出現 template 的 commit 時，不推送，重開分支。

## 4. Issue／PR 編號改寫

template 文件中的 `#N` 指的是 template repo 的 Issue／PR，搬進專案後會被 GitHub 連到專案自己的同號 Issue。

- 搬進專案的檔案中，template 的編號一律改寫成 `<template>#N`（例如來源欄的 `（#<編號>）` 改成 `（<template>#<編號>）`）。專案自己的編號不改。
- **憲法**（`docs/workflow/constitution.md`）只能從 template 升級、不在專案內修改，所以以「把編號還原後與 template 完全相同」驗證：

  ```bash
  gh api -H 'Accept: application/vnd.github.raw' 'repos/<template>/contents/docs/workflow/constitution.md?ref=<head>' > "$TMPDIR/upgrade-constitution.md"
  sed 's|<template>#|#|g' docs/workflow/constitution.md | diff - "$TMPDIR/upgrade-constitution.md"
  ```

  沒有輸出才算通過。

## 5. 拆 PR 的順序

升級通常超過 400 行，依下列順序拆成多個 PR：

1. 規則文件（`docs/workflow/`，含憲法）
2. runner（`tools/workflow/runner/`）
3. 檢查工具（`tools/workflow/` 中既有的工具與測試）
4. 新工具（template 新增的工具）
5. `AGENTS.md` 與文件規則測試（`tools/workflow/doc-rules.test.mjs` 等）：放最後，一次檢查前面各 PR 的結果

- 後一個 PR 等前一個合併後，再從最新的 `main` 開分支。**不疊分支**：疊在前一個 PR 的分支上、前一個以 squash 合併後，後一個會與 `main` 衝突，要多一輪修正。〔來源：疊分支的第二個 PR 在第一個 squash 合併後衝突，多了一輪修正｜不刪〕
- 每個 PR 寫 `Refs #<升級 Issue>`，最後一個 PR 才寫 `Closes`（有合併後人工待辦時也寫 `Refs`）。

## 6. 人工步驟

以下由人執行，在升級 Issue 的人工待辦列出：

- **`.claude/` 的新增與刪除**：agent 不能寫入 `.claude/`（runner 下也不行），新的命令檔、設定的變更由人複製或刪除。
- **改到 runner 的 PR 合併後**：在主資料夾 `git pull`，下一次排程才會用新版 runner。
- **清理 runner worktree**：升級後 runner 的 worktree 可能留有舊版產生的未追蹤檔案，導致 runner 判斷有未提交的變更而停下；先確認內容再刪除。
- **多個 PR 時**：每個 PR 合併後，把升級 Issue 加回 `agent:ready`，讓 agent（或 runner）接著做下一個 PR。

## 7. 增量升級

已經升級過的專案，下一次以**上次升到的 commit** 為 `<base>`，不再從建立時的版本比對。

- 每次升級完成時，在升級 Issue（或 `AGENTS.md` 第 0 節的憲法版本旁）記下 `<head>` 的 commit SHA，下次直接使用。
- 沒有記錄時，依[第 1 節](#1-找出建立時的版本)的方法，以專案現況中「未改過的共用檔案」比對 template 的 commit 找出來。

## 8. 升級 Issue 的範本

決策中心開升級 Issue 時複製下列內容，填入角括號的部分：

```markdown
## 目標

把本專案的 template 從 <base 的憲法版本>（<base> 的 commit）升級到 <head 的憲法版本>（<head> 的 commit）。程序見 docs/workflow/upgrade.md。

## 範圍

- template 在 <base>..<head> 之間改動的共用檔案，依 upgrade.md 第 2 節分成 A／B／C 三類處理
- 分類結果：<列出各類的檔案，或寫「第一個 PR 列出」>
- 範圍外：專案自己的程式與文件；template 刪除、但專案改過的檔案（列出，由人決定）

## 限制

- 只以 gh api 讀取 template，不 fetch、不合併 template 的歷史（upgrade.md 第 3 節）
- template 的 Issue／PR 編號改寫成 <template>#N（upgrade.md 第 4 節）
- 依 upgrade.md 第 5 節的順序拆 PR，不疊分支；每個 PR 寫 Refs，最後一個寫 Closes
- .claude/ 的變更由人處理（upgrade.md 第 6 節）

## 驗收條件

- [ ] 每個 PR 的 `git log origin/main..HEAD --format='%an %ae'` 沒有 template 的 commit
- [ ] 憲法還原編號後與 <head> 的 template 完全相同
- [ ] 專案的測試與 CI 通過
- [ ] AGENTS.md 第 0 節的憲法版本為 <head 的憲法版本>，並記下 <head> 的 commit（下次增量升級用）

## 人工待辦

- [ ] .claude/ 的新增與刪除：<列出>
- [ ] 改到 runner 的 PR 合併後，在主資料夾 git pull；清理 runner worktree 的未追蹤檔案
- [ ] 每個 PR 合併後加回 agent:ready
```
