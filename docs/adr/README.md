# ADR：架構決策紀錄

ADR（Architecture Decision Record）記錄「決定了什麼、為什麼、放棄了什麼」。一個決策一份，一頁以內。

## 什麼時候寫

符合任一條件就寫：

- 難以反悔（資料庫、框架、資料模型、部署平台）。
- coding agent 可能想「改正」它。
- 曾在幾個選項之間猶豫。

其他決定寫在 Issue 或 PR 即可。

## 規則

- 檔名：`NNNN-<kebab-case-title>.md`，編號遞增不重用。ADR 0001 是技術選型。
- 狀態：`Proposed` → `Accepted`／`Rejected`；被取代時改為 `Superseded by ADR NNNN`，不刪除舊檔。
- 已 `Accepted` 的 ADR 不改寫決策內容；改方向就新增一份 ADR 取代它。
- 單人專案可先以 `Proposed` 合併，隔天重看再改 `Accepted`（選用的冷卻期）。
- 以 PR 提交，不能走快速通道。

## 範本

```markdown
# ADR NNNN：標題

- 狀態：Proposed
- 日期：YYYY-MM-DD
- 相關：Issue／PR／RFC

## 背景
## 選項
## 決定
## 後果（好處、代價、後續工作）
```

## 索引

| 編號 | 決策 | 狀態 |
| --- | --- | --- |
| [0001](0001-tech-stack.md) | 技術選型（Vite＋TypeScript＋React、PGlite、Cloudflare Worker） | Accepted |
| [0002](0002-document-parsing.md) | 上傳文件的解析套件（`pdfjs-dist`、`mammoth`，只在瀏覽器中擷取文字） | Accepted |
| [0003](0003-automation-runner.md) | 啟用自動化模組（本機 runner，以 launchd 排程） | Accepted |
| [0004](0004-e2e-and-secret-scanning.md) | Playwright（`@playwright/test`，只用 Chromium）與 gitleaks（固定版本＋SHA-256）的版本與來源 | Accepted |
| [0005](0005-online-demo.md) | 線上 demo 的部署方式（同一個 Worker、`env.demo`、由人手動部署）與費用上限 | Accepted |
| [0006](0006-semantic-retrieval.md) | 語意向量檢索（瀏覽器內的 `multilingual-e5-small`，可選；`keyword-hash` 保留為預設） | Accepted |
| [0007](0007-retraction-and-answer-reports.md) | 使用中修正（撤回待審項目的決定、只能新增的撤回紀錄；回答錯誤回報以送出的段落判斷可見範圍） | Proposed |
| [0008](0008-design-system.md) | 視覺設計系統（Light／Dark 共用 token，證據色固定，說法不同用洋紅） | Accepted |
