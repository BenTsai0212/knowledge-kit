# 方法與文件套件（playbook）

為新客戶準備第二大腦 demo 時使用的方法文件。依使用順序：

| 順序 | 文件 | 給誰 | 用途 |
| --- | --- | --- | --- |
| 1 | [需求確認清單](requirements-checklist.md) | 可直接給客戶 | 第一次訪談，確認要展示什麼、給誰看、誰能看什麼 |
| 2 | [資料盤點表](data-inventory.md) | 可直接給客戶填寫 | 盤點文件的種類、機密程度、語言與負責人，決定 demo 用哪些資料 |
| 3 | [資料安全說明](data-security.md) | 可直接給客戶 | 說明 demo 怎麼處理資料、哪些資料不能放進 demo |
| 4 | [評測題庫建立步驟](eval-question-bank.md) | 內部（可附給客戶參考） | 和客戶一起出題，量化問答品質 |
| 5 | [驗收指標](acceptance-metrics.md) | 內部（可附給客戶參考） | demo 交付前要達到的門檻，以及怎麼解讀結果 |
| 6 | [落地新客戶步驟](new-client-setup.md) | 內部（給 coding agent） | 依訪談與盤點建立 clients/<名稱>/ 的 demo |

技術設定（`client/` 的每個檔案）見 [docs/client-config.md](../client-config.md)；落地新客戶的完整步驟見[落地新客戶步驟](new-client-setup.md)。

## 寫法原則

- **中立**：不寫任何真實客戶、合作夥伴或產業特定公司的名稱；範例一律使用參考情境的虛構公司。
- **不誇大**：demo 是展示用的原型，不是正式系統。對外說法以「展示」「原型」描述，不承諾正式系統的功能、效能或安全等級。
- **繁中與英文各一份**：`docs/playbook/` 為繁中，`docs/playbook/en/` 為英文，內容一致；修改時兩份一起改。
