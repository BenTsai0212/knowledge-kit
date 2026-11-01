# 示例醫材資料集

示例醫材（Demo Medical Supply）的**虛構**資料：文件、段落、實體與關係。所有公司、原廠、醫院、人物、產品與金額都是虛構的（Issue #88）。

- 格式與檢查：[docs/dataset.md](../../../docs/dataset.md)
- 不要放入真實客戶資料（AGENTS.md 第 5 節）

## 內容

約 40 人的醫療器材代理商，代理 Corvane Medtech 與 Lumiden Instruments 兩家原廠的產品。22 份文件（繁中 11、英文 11），66 段（繁中 33、英文 33）。

| 文件 | 語言 | 等級 | 專案 |
| --- | --- | --- | --- |
| 公司簡介 `company-profile` | zh-TW、en | 公開 | |
| 產品簡介 `product-overview` | zh-TW | 公開 | |
| Tessiva 血壓監測儀型錄 `tessiva-bp-catalog`、Tessiva 超音波探頭型錄 `tessiva-probe-catalog` | en | 公開 | |
| 2026 Q4 價目表 `price-list-2026q4` | zh-TW、en | 內部 | |
| 2026 Q4 底價與毛利表 `floor-price-2026q4` | zh-TW、en | 機密 | |
| Tessiva 血壓監測儀保養與校正手冊 `tessiva-bp-service-manual` | en | 內部 | |
| 保養與校正重點摘要 `service-summary` | zh-TW | 內部 | |
| 保固規定 2025 年版 `warranty-2025`、2026 年版 `warranty-2026` | zh-TW、en | 內部 | |
| 客戶負責人清單 `account-owners` | zh-TW、en | 內部 | |
| 青嵐新院區標案進度報告 `qinglan-tender-status` | zh-TW、en | 內部（`-03` 投標金額為機密） | `qinglan-tender` |
| 員工手冊 `employee-handbook` | zh-TW、en | 內部 | |
| 2026 年調薪公告 `salary-adjustment-2026` | zh-TW | 機密 | |

示範素材：

- **權限（等級）**：Tessiva 血壓監測儀的價格分三層：型錄（公開，沒有價格）、價目表的牌價（內部）、底價與毛利（機密）。
- **專案**：標案進度報告只有 `qinglan-tender` 的成員（`sales`、`gm`）看得到；`engineer` 等級相同但不是成員。
- **比文件更機密的段落**：`qinglan-tender-status-zh-03`、`-en-03`（投標金額），`sales` 是專案成員也看不到。
- **新舊說法**：保固規定 2025 年版（主機 1 年）與 2026 年版（主機 2 年、配件 1 年），兩種語言各一組；2026 年版寫明取代舊版。
- **同名**：兩款 Tessiva：Corvane Medtech 的血壓監測儀（BP-220）與 Lumiden Instruments 的超音波探頭（UP-35）；`product-overview-zh-02`、`tessiva-probe-catalog-en-03` 明確區分。
- **別名**：醫院的全名與簡稱（青嵐醫院／青嵐、松澗醫院／松澗），人物的中英文名稱（`aliases`）。
