# ADR 0010：E2E 在 PR 階段執行

- 狀態：Proposed
- 日期：2026-11-12
- 決定者：@BenTsai0212
- 相關：#306、[ADR 0004](0004-e2e-and-secret-scanning.md)「與 ADR 0001 的差異」第 2 點（Playwright 的執行時機，本 ADR 取代這一點）、[docs/testing.md](../testing.md)「Playwright」的「CI」

## 背景

ADR 0004 決定 Playwright 只在 push 到 `main` 後執行，另可用 `workflow_dispatch` 對分支手動執行，不在每個 PR 執行，以免拉長 PR 的 CI 時間。

實際運作後，每個 PR 都要由決策中心在本機 build 後跑完整 E2E（約 5 分鐘），曾因本機用到舊的 `dist/` 而誤判；#299 的版面問題來回修了 4 輪，也是因為 PR 階段看不到 E2E。knowledge-kit 是公開 repo，GitHub 提供的標準 runner 不計費。

## 選項

1. 維持只在 push 到 `main` 後執行，PR 由決策中心在本機驗證。
2. 在 PR（目標 `main`）也執行同一個 `e2e.yml`，但不列為分支保護的必要檢查。
3. 同 2，並列為必要檢查。

## 決定

採用選項 2（#306）：

- `e2e.yml` 加上 `pull_request`（目標 `main`）觸發，保留 push 到 `main` 與 `workflow_dispatch`；矩陣（參考情境與每個示範客戶）與線上 demo 一格都在 PR 上執行。
- 以 `concurrency` 讓同一個 PR 推新的 commit 時取消舊的執行；push 到 `main` 與手動執行每次各自一個群組，不會被取消。
- 觸發用 `pull_request`，不用 `pull_request_target`，也不使用任何 secret（`/api/ask` 一律由測試回傳假的回應），所以 fork 來的 PR 也只以唯讀權限執行。
- 成功時也上傳 HTML 報告（保留 7 天），附截圖的測試（例如 `e2e/english-layout.spec.ts`）在 PR 上就能查看；失敗時照舊上傳 trace 與截圖。
- E2E 不列為必要檢查，之後視執行時間再決定。

## 後果

- **好處**：審查時直接看 CI 的 E2E 結果；runner 交出 PR 時也看得到 E2E 是否通過；決策中心不再於本機重跑完整 E2E 與單元測試。
- **代價**：每個 PR 都要下載 Chromium 並跑完整矩陣，PR 的 CI 時間變長（不阻擋合併，因為不是必要檢查）。GitHub 端異常（例如安裝瀏覽器失敗、服務中斷）也會讓 PR 上的 E2E 失敗，處理方式見 [docs/workflow/decision-center.md](../workflow/decision-center.md) 第 4 節。
- **後續工作**：視 PR 上的執行時間決定是否列為必要檢查。
