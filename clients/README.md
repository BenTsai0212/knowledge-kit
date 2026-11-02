# clients/：各客戶的設定

每個客戶一個資料夾 `clients/<名稱>/`，結構與參考情境 `client/` 相同（`client.json` 等設定檔、`i18n/`、`data/`、`evals/`），但**不含 `schema/`**：Schema 一律用 `client/schema/`。名稱只能用小寫英文字母、數字與 `-`。

本 repo（template）不放任何客戶，只有這份說明（#77 決定 7）。`client/` 是參考情境與測試基準，換客戶時不修改。

## 用法

| 指令 | 用途 |
| --- | --- |
| `npm run check:clients <名稱>` | 設定檢查、target 測試、build（不需要環境變數） |
| `npm run check:client -- clients/<名稱>/` | 只做設定檢查 |
| `KK_CLIENT=<名稱> npm run dev` | 以該客戶啟動開發伺服器（由人執行） |
| `KK_CLIENT=<名稱> npm run build` | 以該客戶 build 到 `dist/`（由人執行） |

說明見 [docs/client-config.md](../docs/client-config.md)「多客戶與切換」。
