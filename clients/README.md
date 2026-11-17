# clients/：各客戶的設定

每個客戶一個資料夾 `clients/<名稱>/`，結構與參考情境 `client/` 相同（`client.json` 等設定檔、`i18n/`、`data/`、`evals/`），但**不含 `schema/`**：Schema 一律用 `client/schema/`。名稱只能用小寫英文字母、數字與 `-`。

**翻譯檔只寫與參考情境不同的文字**（#406）：`clients/<名稱>/i18n/<語言>.json` 缺少的鍵在 build 時用 `client/i18n/<同語言>.json` 的文字，`client/` 沒有這個語言時（例如日文）用 `client/` 的預設語言，並在 `check:client` 列出警告；巢狀的鍵逐個子鍵退回。沒有要改的文字時寫空物件 `{}`。新增畫面文字時只改 `client/i18n/`。規則見 [docs/client-config.md](../docs/client-config.md)「客戶的翻譯檔」。

本 repo（template）只放**虛構的示範客戶**，真實客戶與給特定對象的 pitch demo 放在各自的 fork（#77 決定 7）。`client/` 是參考情境與測試基準，換客戶時不修改。

| 客戶 | 內容 | Issue |
| --- | --- | --- |
| `medsupply-demo` | 虛構的醫療器材代理商，`keyword-hash` | #88 |
| `kestrova-demo` | 虛構的跨國感測器製造商，繁中、英文、日文，每個事實只寫在一種語言，以語意向量（`multilingual-e5-small`）跨語言檢索 | #175 |

## 用法

| 指令 | 用途 |
| --- | --- |
| `npm run check:clients <名稱>` | 設定檢查、target 測試、build（不需要環境變數） |
| `npm run check:client -- clients/<名稱>/` | 只做設定檢查 |
| `KK_CLIENT=<名稱> npm run dev` | 以該客戶啟動開發伺服器（由人執行） |
| `KK_CLIENT=<名稱> npm run build` | 以該客戶 build 到 `dist/`（由人執行） |

說明見 [docs/client-config.md](../docs/client-config.md)「多客戶與切換」。
